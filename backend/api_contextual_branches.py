"""API endpoints for contextual branching (span-anchored clarification threads)."""
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from typing import List

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
    get_branch,
    add_branch_message,
    get_message_branches,
    save_bridging_hints,
    get_parent_message_content,
    store_parent_message_version,
    archive_branch,
    delete_branch,
)
try:
    from services_logging import log_event
except ImportError:
    # Fallback if services_logging doesn't exist
    def log_event(event_type: str, data: dict):
        print(f"[Event] {event_type}: {data}")

router = APIRouter(prefix="/contextual-branches", tags=["contextual-branches"])


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
    import os
    import openai
    
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
    
    # Get assistant reply using LLM
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")
    
    # Get parent message content from DB (using the version stored with branch)
    parent_message_content = get_parent_message_content(
        branch.parent_message_id,
        branch.parent_message_version
    )
    
    if not parent_message_content:
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
    system_prompt = _build_span_explanation_prompt(parent_message_content, selected_text)
    
    try:
        client = openai.OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                *conversation_history
            ],
            temperature=0.7,
            max_tokens=1000,
        )
        
        assistant_content = response.choices[0].message.content
        
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
    
    if not branch.messages:
        raise HTTPException(status_code=400, detail="Branch has no messages yet")
    
    # Get parent message content from DB (using the version stored with branch)
    parent_content = get_parent_message_content(
        branch.parent_message_id,
        branch.parent_message_version
    )
    
    if not parent_content:
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
    
    # Generate bridging hints using LLM
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")
    
    try:
        client = openai.OpenAI(api_key=api_key)
        prompt = _build_bridging_hints_prompt(parent_content, selected_text, explanation)
        
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a helpful assistant that generates bridging hints."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=800,
            response_format={"type": "json_object"}
        )
        
        result = response.choices[0].message.content
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
