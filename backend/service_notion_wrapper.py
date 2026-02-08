"""
Notion API client wrapper for Brain Web
Provides functions to fetch pages, blocks, and database content
"""
from typing import List, Dict, Any, Optional
from notion_client import Client
import os

from config import NOTION_API_KEY

# Initialize Notion client
NOTION_CLIENT = None
if NOTION_API_KEY:
    try:
        NOTION_CLIENT = Client(auth=NOTION_API_KEY)
    except Exception as e:
        print(f"Warning: Failed to initialize Notion client: {e}")
else:
    print("Warning: NOTION_API_KEY not set - Notion features will not work")


def _ensure_client():
    """Ensure Notion client is initialized"""
    if not NOTION_API_KEY:
        raise ValueError("NOTION_API_KEY environment variable is not set")
    if not NOTION_CLIENT:
        raise ValueError("Notion client not initialized")
    return NOTION_CLIENT


def get_page(page_id: str) -> Dict[str, Any]:
    """
    Fetch a single Notion page by ID.
    
    Args:
        page_id: Notion page ID (with or without hyphens)
    
    Returns:
        Page object from Notion API
    
    Raises:
        ValueError: If API key is missing or page fetch fails
    """
    client = _ensure_client()
    normalized_id = page_id.replace("-", "")
    
    try:
        return client.pages.retrieve(page_id=normalized_id)
    except Exception as e:
        _handle_notion_error(e, f"fetch Notion page {page_id}")


def _handle_notion_error(e: Exception, operation: str) -> None:
    """Handle Notion API errors with helpful messages"""
    error_msg = str(e)
    if "401" in error_msg or "unauthorized" in error_msg.lower() or "invalid" in error_msg.lower():
        raise ValueError(
            f"Notion API authentication failed (401 Unauthorized) during {operation}. "
            f"Your NOTION_API_KEY is invalid or expired. "
            f"Please check your integration token at https://www.notion.so/my-integrations"
        )
    raise ValueError(f"Failed to {operation}: {error_msg}")


def get_page_blocks(page_id: str) -> List[Dict[str, Any]]:
    """
    Fetch all blocks (content) from a Notion page.
    Handles pagination automatically.
    
    Args:
        page_id: Notion page ID (with or without hyphens)
    
    Returns:
        List of block objects from the page
    
    Raises:
        ValueError: If API key is missing or block fetch fails
    """
    client = _ensure_client()
    normalized_id = page_id.replace("-", "")
    
    blocks = []
    cursor = None
    
    try:
        while True:
            if cursor:
                response = client.blocks.children.list(block_id=normalized_id, start_cursor=cursor)
            else:
                response = client.blocks.children.list(block_id=normalized_id)
            
            blocks.extend(response.get("results", []))
            
            if not response.get("has_more"):
                break
            
            cursor = response.get("next_cursor")
    except Exception as e:
        _handle_notion_error(e, f"fetch blocks for page {page_id}")
    
    return blocks


def get_database_pages(database_id: str, filter_conditions: Optional[Dict] = None) -> List[Dict[str, Any]]:
    """
    Query a Notion database and return all pages.
    
    Args:
        database_id: Notion database ID (with or without hyphens)
        filter_conditions: Optional Notion filter object (e.g., for date filtering)
    
    Returns:
        List of page objects from the database
    
    Raises:
        ValueError: If API key is missing or database query fails
    """
    client = _ensure_client()
    normalized_id = database_id.replace("-", "")
    
    pages = []
    cursor = None
    
    try:
        while True:
            query_params = {
                "database_id": normalized_id,
            }
            
            if filter_conditions:
                query_params["filter"] = filter_conditions
            
            if cursor:
                query_params["start_cursor"] = cursor
            
            response = client.databases.query(**query_params)
            
            pages.extend(response.get("results", []))
            
            if not response.get("has_more"):
                break
            
            cursor = response.get("next_cursor")
    except Exception as e:
        _handle_notion_error(e, f"query database {database_id}")
    
    return pages


def extract_plaintext_from_blocks(blocks: List[Dict[str, Any]]) -> str:
    """
    Flatten Notion blocks into a single plain text string.
    Preserves order and handles nested blocks recursively.
    
    Args:
        blocks: List of Notion block objects
    
    Returns:
        Plain text string with all content
    """
    text_lines = []
    
    def extract_from_block(block: Dict[str, Any]) -> None:
        """Recursively extract text from a block and its children"""
        block_type = block.get("type")
        block_data = block.get(block_type, {})
        
        # Extract text from rich_text fields (common in most block types)
        if "rich_text" in block_data:
            rich_text = block_data["rich_text"]
            if rich_text:
                text = "".join([item.get("plain_text", "") for item in rich_text])
                if text.strip():
                    text_lines.append(text)
        
        # Handle specific block types
        if block_type == "code":
            code_text = block_data.get("rich_text", [])
            if code_text:
                code = "".join([item.get("plain_text", "") for item in code_text])
                if code.strip():
                    text_lines.append(f"```\n{code}\n```")
        
        # Handle table blocks (extract cell text)
        if block_type == "table":
            # Tables have table_rows as children, handled separately
            pass
        
        # Recursively process children blocks
        if block.get("has_children", False):
            try:
                block_id = block.get("id")
                if block_id and NOTION_CLIENT:
                    normalized_id = block_id.replace("-", "")
                    children_response = NOTION_CLIENT.blocks.children.list(block_id=normalized_id)
                    for child_block in children_response.get("results", []):
                        extract_from_block(child_block)
            except Exception as e:
                # Silently skip children if we can't fetch them
                pass
    
    # Process all blocks
    for block in blocks:
        extract_from_block(block)
    
    return "\n".join(text_lines)


def get_page_title(page: Dict[str, Any]) -> str:
    """
    Extract title from a Notion page object.
    
    Args:
        page: Notion page object
    
    Returns:
        Page title or "Untitled" if not found
    """
    props = page.get("properties", {})
    
    # Try to find title property
    for prop_name, prop_value in props.items():
        if prop_value.get("type") == "title":
            title_rich_text = prop_value.get("title", [])
            if title_rich_text:
                return "".join([t.get("plain_text", "") for t in title_rich_text])
    
    # Try common property names
    for name in ["Name", "Title"]:
        if name in props:
            prop = props[name]
            if prop.get("type") == "title":
                title_rich_text = prop.get("title", [])
                if title_rich_text:
                    return "".join([t.get("plain_text", "") for t in title_rich_text])
    
    return "Untitled"


def get_page_domain(page: Dict[str, Any], database_name: Optional[str] = None) -> Optional[str]:
    """
    Extract domain from a Notion page object.
    Looks for a "Domain" property or infers from database name.
    
    Args:
        page: Notion page object
        database_name: Optional database name to use as fallback
    
    Returns:
        Domain string or None
    """
    props = page.get("properties", {})
    
    # Try to find Domain property
    if "Domain" in props:
        domain_prop = props["Domain"]
        if domain_prop.get("type") == "rich_text":
            domain_text = domain_prop.get("rich_text", [])
            if domain_text:
                domain = "".join([t.get("plain_text", "") for t in domain_text])
                if domain.strip():
                    return domain.strip()
        elif domain_prop.get("type") == "select":
            select = domain_prop.get("select")
            if select:
                return select.get("name")
    
    # Fall back to database name if provided
    if database_name:
        return database_name
    
    return None
