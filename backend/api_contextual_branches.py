"""API endpoints for contextual branching (span-anchored clarification threads)."""
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from auth import require_auth
from models_contextual_branches import (
    BranchCreateRequest,
    BranchMessageRequest,
    BranchResponse,
    MessageBranchesResponse,
    BridgingHintsResponse,
)
from services_contextual_branches import (
    create_branch,
    create_anchor_branch,
    get_branch,
    add_branch_message,
    get_message_branches,
    save_bridging_hints,
    get_parent_message_content,
    store_parent_message_version,
    archive_branch,
    delete_branch,
)
from unified_primitives import AnchorRef, ArtifactRef, BBoxSelector
try:
    from services_logging import log_event
except ImportError:
    # Fallback if services_logging doesn't exist
    def log_event(event_type: str, data: dict):
        print(f"[Event] {event_type}: {data}")

router = APIRouter(prefix="/contextual-branches", tags=["contextual-branches"])


class AnchorBranchCreateRequest(BaseModel):
    """
    Create a branch from a non-text anchor (currently bbox lasso).

    This is additive; the existing POST /contextual-branches span endpoint remains unchanged.
    """

    artifact: ArtifactRef
    bbox: BBoxSelector
    snippet_image_data_url: Optional[str] = Field(default=None, description="Optional data URL preview for vision grounding")
    preview: Optional[str] = Field(default=None, description="Short preview label for the selection")
    context: Optional[str] = Field(default=None, description="Optional parent context text (e.g., concept title)")
    chat_id: Optional[str] = Field(default=None, description="Optional chat session id for downstream linkage")


@router.post("/anchor", response_model=BranchResponse)
def create_anchor_branch_endpoint(
    payload: AnchorBranchCreateRequest,
    req: Request,
    auth: dict = Depends(require_auth),
):
    """Create a new contextual branch from a bbox anchor selection."""
    user_id = auth.get("user_id", "anonymous")

    # Phase A: only bbox anchors
    if payload.bbox.kind != "bbox":
        raise HTTPException(status_code=400, detail="Only bbox anchors are supported for /contextual-branches/anchor")

    try:
        if not payload.chat_id:
            payload.chat_id = getattr(req.state, "session_id", None)

        anchor = AnchorRef.create(
            artifact=payload.artifact,
            selector=payload.bbox,
            preview=payload.preview,
        )

        branch = create_anchor_branch(
            anchor_ref=anchor.model_dump(mode="json"),
            snippet_image_data_url=payload.snippet_image_data_url,
            context=payload.context,
            chat_id=payload.chat_id,
            user_id=user_id,
        )

        return BranchResponse(branch=branch, messages=branch.messages)
    except ConnectionError as e:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {str(e)}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create anchor branch: {str(e)}")


@router.post("", response_model=BranchResponse)
def create_branch_endpoint(
    request: BranchCreateRequest,
    req: Request,
    auth: dict = Depends(require_auth),
):
    """Create a new contextual branch from a text span selection."""
    user_id = auth.get("user_id", "anonymous")
    
    # Validate selection
    if request.start_offset < 0 or request.end_offset <= request.start_offset:
        raise HTTPException(status_code=400, detail="Invalid span offsets")
    
    if not request.selected_text or not request.selected_text.strip():
        raise HTTPException(status_code=400, detail="Selected text cannot be empty")
    
    try:
        if not request.chat_id:
            request.chat_id = getattr(req.state, "session_id", None)
        # create_branch now stores parent message content in DB automatically
        branch = create_branch(request, user_id)
        
        return BranchResponse(
            branch=branch,
            messages=branch.messages
        )
    except ConnectionError as e:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create branch: {str(e)}")


@router.get("/{branch_id}", response_model=BranchResponse)
def get_branch_endpoint(
    branch_id: str,
    req: Request,
    auth: dict = Depends(require_auth),
):
    """Get branch metadata and all messages."""
    user_id = auth.get("user_id", "anonymous")
    
    try:
        branch = get_branch(branch_id)
    except ConnectionError as e:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get branch: {str(e)}")
    
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    
    log_event("branch_opened", {
        "branch_id": branch_id,
        "user_id": user_id,
    })
    
    return BranchResponse(
        branch=branch,
        messages=branch.messages
    )


@router.post("/{branch_id}/messages")
def send_branch_message_endpoint(
    branch_id: str,
    request: BranchMessageRequest,
    req: Request,
    auth: dict = Depends(require_auth),
):
    """Send a user message in a branch and get assistant reply."""
    from services_contextual_branches import get_branch
    from services_model_router import model_router, TASK_CHAT_FAST

    user_id = auth.get("user_id", "anonymous")
    
    # Verify branch exists
    try:
        branch = get_branch(branch_id)
    except ConnectionError as e:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get branch: {str(e)}")
    
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    
    # Add user message
    try:
        user_msg = add_branch_message(branch_id, "user", request.content, user_id)
    except ConnectionError as e:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to add message: {str(e)}")
    
    if not model_router.client:
        raise HTTPException(status_code=500, detail="OpenAI client not configured (check OPENAI_API_KEY)")
    
    # Get parent message content from DB (using the version stored with branch)
    parent_message_content = get_parent_message_content(
        branch.parent_message_id,
        branch.parent_message_version
    )
    
    if parent_message_content is None:
        raise HTTPException(status_code=404, detail="Parent message content not found")
    
    selected_text = branch.anchor.selected_text
    
    # Build conversation history
    conversation_history = []
    for msg in branch.messages:
        conversation_history.append({
            "role": msg.role,
            "content": msg.content
        })
    conversation_history.append({
        "role": "user",
        "content": request.content
    })
    
    # Generate explanation using LLM
    anchor_kind = getattr(branch, "anchor_kind", "text_span") or "text_span"
    anchor_ref = getattr(branch, "anchor_ref", None)
    anchor_snippet = getattr(branch, "anchor_snippet_data_url", None)
    is_anchor_ref = anchor_kind == "anchor_ref" and isinstance(anchor_ref, dict)

    if is_anchor_ref:
        system_prompt = _build_anchor_ref_explanation_prompt(parent_message_content or "", anchor_ref)
    else:
        system_prompt = _build_span_explanation_prompt(parent_message_content or "", selected_text)
    
    try:
        messages: list[dict] = [{"role": "system", "content": system_prompt}]
        if is_anchor_ref and anchor_snippet:
            messages.append({
                "role": "user",
                "content": [
                    {"type": "text", "text": "Selected region (image):"},
                    {"type": "image_url", "image_url": {"url": anchor_snippet}},
                ],
            })

        assistant_content = model_router.completion(
            task_type=TASK_CHAT_FAST,
            messages=[*messages, *conversation_history],
            temperature=0.7,
            max_tokens=1000,
        )
        
        # Add assistant message
        try:
            assistant_msg = add_branch_message(branch_id, "assistant", assistant_content, user_id)
        except ConnectionError as e:
            raise HTTPException(status_code=503, detail=f"Database unavailable: {str(e)}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to add assistant message: {str(e)}")
        
        log_event("branch_message_sent", {
            "branch_id": branch_id,
            "message_id": assistant_msg.id,
            "role": "assistant",
            "user_id": user_id,
        })
        
        return {
            "user_message": user_msg,
            "assistant_message": assistant_msg
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate response: {str(e)}")


@router.post("/{branch_id}/hints", response_model=BridgingHintsResponse)
def generate_bridging_hints_endpoint(
    branch_id: str,
    req: Request,
    auth: dict = Depends(require_auth),
):
    """Generate bridging hints that connect the clarified concept back to the original response."""
    from services_contextual_branches import get_branch
    import os
    try:
        import openai
    except ImportError:
        raise HTTPException(status_code=500, detail="OpenAI library not installed")
    
    user_id = auth.get("user_id", "anonymous")
    
    # Get branch
    branch = get_branch(branch_id)
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    if getattr(branch, "anchor_kind", "text_span") != "text_span":
        raise HTTPException(status_code=400, detail="Bridging hints are only supported for text span branches")

    if not branch.messages:
        raise HTTPException(status_code=400, detail="Branch has no messages yet")
    
    # Get parent message content from DB (using the version stored with branch)
    parent_content = get_parent_message_content(
        branch.parent_message_id,
        branch.parent_message_version
    )
    
    if parent_content is None:
        raise HTTPException(status_code=404, detail="Parent message content not found")
    
    selected_text = branch.anchor.selected_text
    
    # Get the explanation from branch messages (last assistant message)
    explanation = None
    for msg in reversed(branch.messages):
        if msg.role == "assistant":
            explanation = msg.content
            break
    
    if not explanation:
        raise HTTPException(status_code=400, detail="No explanation found in branch")
    
    if not model_router.client:
        raise HTTPException(status_code=500, detail="OpenAI client not configured (check OPENAI_API_KEY)")

    try:
        from services_model_router import model_router, TASK_CHAT_FAST
        prompt = _build_bridging_hints_prompt(parent_content, selected_text, explanation)

        result = model_router.completion(
            task_type=TASK_CHAT_FAST,
            messages=[
                {"role": "system", "content": "You are a helpful assistant that generates bridging hints."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=800,
            response_format={"type": "json_object"},
        )
        import json
        hints_data = json.loads(result)
        
        # Parse hints and find target offsets in parent message
        hints = []
        for hint_item in hints_data.get("hints", []):
            hint_text = hint_item.get("hint_text", "")
            target_phrase = hint_item.get("target_phrase", "")
            
            # Find offset of target phrase in parent message
            target_offset = parent_content.find(target_phrase)
            if target_offset == -1:
                # Fallback: use end of selected span
                target_offset = branch.anchor.end_offset
            
            hints.append({
                "hint_text": hint_text,
                "target_offset": target_offset
            })
        
        # Save hints
        hint_set = save_bridging_hints(branch_id, hints, user_id)
        
        response = BridgingHintsResponse(
            branch_id=branch_id,
            hints=hint_set.hints
        )
        
        try:
            from services_notes_digest import update_notes_digest
            chat_id = branch.chat_id or getattr(req.state, "session_id", None)
            if chat_id:
                update_notes_digest(chat_id, trigger_source="bridging_hints", branch_id=branch_id)
        except Exception as e:
            log_event("notes_update_failed", {
                "branch_id": branch_id,
                "error": str(e),
                "trigger_source": "bridging_hints",
            })
        
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate hints: {str(e)}")


@router.get("/messages/{message_id}/branches", response_model=MessageBranchesResponse)
def get_message_branches_endpoint(
    message_id: str,
    req: Request,
    include_archived: bool = False,
    auth: dict = Depends(require_auth),
):
    """Get all branches for a parent message."""
    user_id = auth.get("user_id", "anonymous")
    
    try:
        branches = get_message_branches(message_id, include_archived=include_archived)
    except ConnectionError as e:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get branches: {str(e)}")
    
    return MessageBranchesResponse(
        message_id=message_id,
        branches=branches
    )


@router.post("/{branch_id}/archive")
def archive_branch_endpoint(
    branch_id: str,
    req: Request,
    auth: dict = Depends(require_auth),
):
    """Archive a branch (soft delete)."""
    user_id = auth.get("user_id", "anonymous")
    
    success = archive_branch(branch_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="Branch not found")
    
    log_event("branch_archived", {
        "branch_id": branch_id,
        "user_id": user_id,
    })
    
    try:
        from services_notes_digest import update_notes_digest
        branch = get_branch(branch_id)
        chat_id = branch.chat_id if branch else getattr(req.state, "session_id", None)
        if chat_id:
            update_notes_digest(chat_id, trigger_source="branch_closed", branch_id=branch_id)
    except Exception as e:
        log_event("notes_update_failed", {
            "branch_id": branch_id,
            "error": str(e),
            "trigger_source": "branch_closed",
        })
    
    return {"status": "archived", "branch_id": branch_id}


@router.delete("/{branch_id}")
def delete_branch_endpoint(
    branch_id: str,
    req: Request,
    auth: dict = Depends(require_auth),
):
    """Permanently delete a branch and all its messages/hints."""
    user_id = auth.get("user_id", "anonymous")
    
    success = delete_branch(branch_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="Branch not found")
    
    log_event("branch_deleted", {
        "branch_id": branch_id,
        "user_id": user_id,
    })
    
    return {"status": "deleted", "branch_id": branch_id}


@router.post("/messages/{message_id}/new-version")
def create_message_version_endpoint(
    message_id: str,
    req: Request,
    content: str = Body(..., embed=True, description="New version of message content"),
    auth: dict = Depends(require_auth),
):
    """Create a new version of a parent message (for when message is regenerated)."""
    from services_contextual_branches import store_parent_message_version
    
    user_id = auth.get("user_id", "anonymous")
    
    version = store_parent_message_version(message_id, content)
    
    log_event("parent_message_version_created", {
        "message_id": message_id,
        "version": version,
        "user_id": user_id,
    })
    
    return {"message_id": message_id, "version": version}


# Store parent message content in memory for branch context
# Parent message content is now stored in database via services_contextual_branches
# Functions removed - use get_parent_message_content() from services instead


def _build_anchor_ref_explanation_prompt(parent_context: str, anchor_ref: Dict[str, Any]) -> str:
    """Build prompt for explaining a bbox-anchored selection (e.g., ink lasso)."""
    artifact = anchor_ref.get("artifact") or {}
    selector = anchor_ref.get("selector") or {}
    preview = anchor_ref.get("preview") or ""

    artifact_label = f"{artifact.get('namespace')}:{artifact.get('type')}:{artifact.get('id')}"
    selector_kind = selector.get("kind") or "unknown"

    return f"""You are a learning companion helping the user with a specific anchored region from their notes.

ANCHOR CONTEXT:
- Artifact: {artifact_label}
- Selector: {selector_kind}
- Preview: {preview}

PARENT CONTEXT (may be empty):
{parent_context}

You may receive an image of the selected region in the conversation. If so:
- Read/interpret the handwriting or sketch directly.
- If the region is ambiguous, ask ONE clarifying question before assuming.

Response rules:
1) Address what the user asked about the selected region.
2) Be direct about correctness (no glazing).
3) Keep it concise and step-by-step.
4) Prefer concrete next actions (e.g., “label this arrow as X”, “rewrite this line as …”)."""


def _build_span_explanation_prompt(parent_content: str, selected_text: str) -> str:
    """Build prompt for explaining a selected span."""
    return f"""You are explaining a specific portion of text that the user selected from a longer response.

ORIGINAL FULL RESPONSE:
{parent_content}

SELECTED PORTION TO EXPLAIN:
{selected_text}

Your task:
1. Explain ONLY the selected portion in detail
2. Do NOT restate the entire response
3. Focus on what makes this specific part unclear or needs clarification
4. Use examples if helpful
5. Keep your explanation concise but thorough
6. If the user asks follow-up questions, answer them in context of this selected portion

Remember: You are clarifying a specific part, not explaining everything."""


def _build_bridging_hints_prompt(parent_content: str, selected_text: str, explanation: str) -> str:
    """Build prompt for generating bridging hints."""
    return f"""Generate bridging hints that help the user apply the clarification back to the original response.

ORIGINAL FULL RESPONSE:
{parent_content}

SELECTED PORTION THAT WAS CLARIFIED:
{selected_text}

CLARIFICATION PROVIDED:
{explanation}

Your task:
1. Identify 2-4 places in the original response where the clarified concept is used or referenced
2. For each place, generate a brief hint (1-2 sentences) that connects the clarification to that part
3. The hints should help the user understand how the clarification applies to the rest of the response

Return a JSON object with this structure:
{{
  "hints": [
    {{
      "hint_text": "Brief hint connecting clarification to this part",
      "target_phrase": "exact phrase from original response where this applies"
    }}
  ]
}}

Focus on places where the clarified concept appears again or is built upon."""
