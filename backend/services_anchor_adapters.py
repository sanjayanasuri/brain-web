"""
Services for adapting legacy context (text selections) to Unified Anchors.
"""
from typing import Optional, Dict, Any, Tuple
from unified_primitives import (
    AnchorRef,
    ArtifactRef,
    TextOffsetsSelector,
    BBoxSelector,
    TimeRangeSelector,
    compute_anchor_id,
)

def normalize_context_to_anchor(
    page_url: str,
    page_title: Optional[str],
    selection_start: Optional[int],
    selection_end: Optional[int],
    selected_text: Optional[str],
    graph_id: Optional[str] = None,
    branch_id: Optional[str] = None
) -> Optional[AnchorRef]:
    """
    Convert legacy contextual branch parameters into a Unified AnchorRef.

    Legacy "Context":
    - page_url: identifies the artifact (web page or internal route)
    - selection_start/end: text offsets
    - selected_text: the actual content (preview)
    """
    if not page_url:
        return None

    # 1. Construct ArtifactRef
    # For now, we treat web pages as "source_document" artifacts
    # In the future, this might lookup a real Artifact ID from the ingestion kernel
    artifact = ArtifactRef(
        namespace="frontend",  # originating from frontend for now
        type="source_document",
        id=page_url,  # using URL as ID for web pages/routes until we have canonical IDs
        graph_id=graph_id,
        branch_id=branch_id
    )

    # 2. Construct Selector
    selector = None
    if selection_start is not None and selection_end is not None:
        selector = TextOffsetsSelector(
            start_offset=selection_start,
            end_offset=selection_end
        )
    # TODO: Handle BBox or other types if passed via some legacy-compatible dict?
    # For now, this function is specifically for the "selection_start/end" args.

    if not selector:
        return None

    # 3. Create AnchorRef
    return AnchorRef.create(
        artifact=artifact,
        selector=selector,
        preview=selected_text
    )

def resolve_anchor_to_content(anchor: AnchorRef) -> str:
    """
    Resolve (preview) content for an anchor.
    Currently just returns the preview string if present.
    In the future, this would fetch from the Artifact store.
    """
    if anchor.preview:
        return anchor.preview
    
    return f"[{anchor.selector.kind} anchor]"
