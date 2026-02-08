"""
Notion indexing state management for Brain Web
Manages allowlist/blocklist of Notion pages that should be indexed
"""
import json
from pathlib import Path
from typing import Dict, Any, Optional

# State file for tracking which pages are indexed
INDEX_STATE_FILE = Path(__file__).parent / "notion_index_state.json"


def load_index_state() -> Dict[str, Any]:
    """
    Load the index state from local JSON file.
    
    Returns:
        Dictionary with keys: mode, allow, block
        Default: {"mode": "allowlist", "allow": [], "block": []}
    """
    if not INDEX_STATE_FILE.exists():
        # Default: allowlist mode with empty list (nothing indexed by default)
        default_state = {
            "mode": "allowlist",
            "allow": [],
            "block": []
        }
        save_index_state(default_state)
        return default_state
    
    try:
        with open(INDEX_STATE_FILE, "r") as f:
            data = json.load(f)
            # Ensure all required keys exist
            if "mode" not in data:
                data["mode"] = "allowlist"
            if "allow" not in data:
                data["allow"] = []
            if "block" not in data:
                data["block"] = []
            return data
    except Exception as e:
        print(f"Warning: Failed to load index state: {e}")
        # Return default state on error
        default_state = {
            "mode": "allowlist",
            "allow": [],
            "block": []
        }
        return default_state


def save_index_state(state: Dict[str, Any]) -> None:
    """
    Save the index state to local JSON file.
    
    Args:
        state: Dictionary with keys: mode, allow, block
    """
    try:
        # Ensure required keys exist
        if "mode" not in state:
            state["mode"] = "allowlist"
        if "allow" not in state:
            state["allow"] = []
        if "block" not in state:
            state["block"] = []
        
        # Validate mode
        if state["mode"] not in ["allowlist", "blocklist"]:
            state["mode"] = "allowlist"
        
        with open(INDEX_STATE_FILE, "w") as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        print(f"Warning: Failed to save index state: {e}")


def is_page_indexed(page_id: str, state: Optional[Dict[str, Any]] = None) -> bool:
    """
    Check if a page should be indexed based on the current state.
    
    Args:
        page_id: Notion page ID
        state: Optional state dict (if None, loads from file)
    
    Returns:
        True if page should be indexed, False otherwise
    """
    if state is None:
        state = load_index_state()
    
    mode = state.get("mode", "allowlist")
    allow = state.get("allow", [])
    block = state.get("block", [])
    
    if mode == "allowlist":
        # Only pages in allow list are indexed
        return page_id in allow
    else:  # blocklist mode
        # All pages except those in block list are indexed
        return page_id not in block


def set_index_mode(mode: str) -> Dict[str, Any]:
    """
    Set the indexing mode (allowlist or blocklist).
    
    Args:
        mode: "allowlist" or "blocklist"
    
    Returns:
        Updated state dictionary
    """
    if mode not in ["allowlist", "blocklist"]:
        raise ValueError(f"Invalid mode: {mode}. Must be 'allowlist' or 'blocklist'")
    
    state = load_index_state()
    state["mode"] = mode
    save_index_state(state)
    return state


def set_page_indexed(page_id: str, include: bool, state: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Update index state to include or exclude a page.
    
    Args:
        page_id: Notion page ID
        include: True to include, False to exclude
        state: Optional state dict (if None, loads from file)
    
    Returns:
        Updated state dictionary
    """
    if state is None:
        state = load_index_state()
    
    mode = state.get("mode", "allowlist")
    allow = state.get("allow", [])
    block = state.get("block", [])
    
    if include:
        # Add to allowlist or remove from blocklist
        if mode == "allowlist":
            if page_id not in allow:
                allow.append(page_id)
        else:  # blocklist mode
            if page_id in block:
                block.remove(page_id)
    else:
        # Remove from allowlist or add to blocklist
        if mode == "allowlist":
            if page_id in allow:
                allow.remove(page_id)
        else:  # blocklist mode
            if page_id not in block:
                block.append(page_id)
    
    state["allow"] = allow
    state["block"] = block
    save_index_state(state)
    return state
