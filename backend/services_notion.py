"""
Service for fetching Notion pages and ingesting them as lectures into the knowledge graph
"""
from typing import Optional, Tuple, List, Dict, Any
from notion_client import Client
import httpx
import os

from models import LectureIngestRequest, LectureIngestResult
from config import OPENAI_API_KEY, NOTION_API_KEY, BRAINWEB_API_BASE

# Initialize Notion client if API key is available
NOTION = None
if NOTION_API_KEY:
    try:
        NOTION = Client(auth=NOTION_API_KEY)
    except Exception as e:
        print(f"Warning: Failed to initialize Notion client: {e}")


def list_notion_pages() -> List[Dict[str, Any]]:
    """
    Return basic metadata for pages: id, title, url.
    
    Returns:
        List of dicts with keys: id, title, url
    
    Raises:
        ValueError: If NOTION_API_KEY is not set or if API call fails
    """
    if not NOTION_API_KEY:
        raise ValueError("NOTION_API_KEY environment variable is not set")
    
    if not NOTION:
        raise ValueError("Notion client not initialized")
    
    pages = []
    cursor = None
    
    while True:
        try:
            try:
                resp = NOTION.search(
                    query="",
                    filter={"property": "object", "value": "page"},
                    start_cursor=cursor,
                    page_size=50,
                )
            except Exception as api_error:
                error_str = str(api_error)
                if "401" in error_str or "unauthorized" in error_str.lower() or "invalid" in error_str.lower():
                    raise ValueError(
                        "Notion API authentication failed (401 Unauthorized). "
                        "Your NOTION_API_KEY is invalid or expired. "
                        "Please check your integration token at https://www.notion.so/my-integrations"
                    )
                raise
            
            for res in resp["results"]:
                page_id = res["id"]
                props = res.get("properties", {})
                
                # Try to find title property
                title = "Untitled"
                title_prop = props.get("title") or props.get("Name")
                
                if title_prop and title_prop.get("type") == "title":
                    title_rich_text = title_prop.get("title", [])
                    if title_rich_text:
                        title = "".join(t.get("plain_text", "") for t in title_rich_text)
                
                # If still untitled, try first property
                if title == "Untitled" and props:
                    first_prop = next(iter(props.values()), None)
                    if first_prop and first_prop.get("type") == "title":
                        title_rich_text = first_prop.get("title", [])
                        if title_rich_text:
                            title = "".join(t.get("plain_text", "") for t in title_rich_text)
                
                pages.append({
                    "id": page_id,
                    "title": title or "Untitled",
                    "url": res.get("url"),
                })
            
            if not resp.get("has_more"):
                break
            
            cursor = resp.get("next_cursor")
        except ValueError:
            # Re-raise ValueError (which includes our custom auth error messages)
            raise
        except Exception as e:
            error_str = str(e)
            if "401" in error_str or "unauthorized" in error_str.lower():
                raise ValueError(
                    "Notion API authentication failed (401 Unauthorized). "
                    "Your NOTION_API_KEY is invalid or expired. "
                    "Please check your integration token at https://www.notion.so/my-integrations"
                )
            raise ValueError(f"Failed to list Notion pages: {error_str}")
    
    return pages


def list_notion_databases() -> List[Dict[str, Any]]:
    """
    Return basic metadata for databases: id, title, url.
    
    Returns:
        List of dicts with keys: id, title, url
    
    Raises:
        ValueError: If NOTION_API_KEY is not set or if API call fails
    """
    if not NOTION_API_KEY:
        raise ValueError("NOTION_API_KEY environment variable is not set")
    
    if not NOTION:
        raise ValueError("Notion client not initialized")
    
    dbs = []
    cursor = None
    
    while True:
        try:
            resp = NOTION.search(
                query="",
                filter={"property": "object", "value": "database"},
                start_cursor=cursor,
                page_size=50,
            )
            
            for res in resp["results"]:
                db_id = res["id"]
                title_prop = res.get("title", [])
                
                title = "Untitled database"
                if title_prop:
                    title = "".join(t.get("plain_text", "") for t in title_prop)
                
                dbs.append({
                    "id": db_id,
                    "title": title or "Untitled database",
                    "url": res.get("url"),
                })
            
            if not resp.get("has_more"):
                break
            
            cursor = resp.get("next_cursor")
        except ValueError:
            # Re-raise ValueError (which includes our custom auth error messages)
            raise
        except Exception as e:
            error_str = str(e)
            if "401" in error_str or "unauthorized" in error_str.lower():
                raise ValueError(
                    "Notion API authentication failed (401 Unauthorized). "
                    "Your NOTION_API_KEY is invalid or expired. "
                    "Please check your integration token at https://www.notion.so/my-integrations"
                )
            raise ValueError(f"Failed to list Notion databases: {error_str}")
    
    return dbs


def flatten_notion_page_to_text(page_id: str) -> Tuple[str, str]:
    """
    Fetches a Notion page by page_id and flattens it into title and plain text.
    
    Args:
        page_id: Notion page ID (UUID format, with or without hyphens)
    
    Returns:
        Tuple of (lecture_title, lecture_text) where:
        - lecture_title: The page title
        - lecture_text: Newline-joined plain text of all blocks
    
    Raises:
        ValueError: If NOTION_API_KEY is not set or if page fetch fails
    """
    if not NOTION_API_KEY:
        raise ValueError("NOTION_API_KEY environment variable is not set")
    
    if not NOTION:
        raise ValueError("Notion client not initialized")
    
    # Use the global NOTION client
    notion = NOTION
    
    # Normalize page_id (remove hyphens if present, Notion API expects UUID without hyphens)
    normalized_page_id = page_id.replace("-", "")
    
    try:
        # Fetch the page
        page = notion.pages.retrieve(page_id=normalized_page_id)
        
        # Extract title from page properties
        # Notion pages have a title property that can be in different formats
        title = "Untitled"
        if "properties" in page:
            # Try to find a title property (common names: "Title", "Name", or the first property)
            for prop_name, prop_value in page["properties"].items():
                if prop_value.get("type") == "title":
                    title_rich_text = prop_value.get("title", [])
                    if title_rich_text:
                        title = "".join([text.get("plain_text", "") for text in title_rich_text])
                        break
                elif prop_name.lower() in ["title", "name"] and prop_value.get("type") == "title":
                    title_rich_text = prop_value.get("title", [])
                    if title_rich_text:
                        title = "".join([text.get("plain_text", "") for text in title_rich_text])
                        break
        
        # If no title found in properties, try the page object itself
        if title == "Untitled" and "properties" in page:
            # Get the first property that might be a title
            first_prop = next(iter(page["properties"].values()), None)
            if first_prop and first_prop.get("type") == "title":
                title_rich_text = first_prop.get("title", [])
                if title_rich_text:
                    title = "".join([text.get("plain_text", "") for text in title_rich_text])
        
        # Fetch all blocks in the page
        blocks = []
        cursor = None
        
        while True:
            if cursor:
                response = notion.blocks.children.list(block_id=normalized_page_id, start_cursor=cursor)
            else:
                response = notion.blocks.children.list(block_id=normalized_page_id)
            
            blocks.extend(response.get("results", []))
            
            if not response.get("has_more"):
                break
            
            cursor = response.get("next_cursor")
        
        # Flatten blocks to plain text
        text_lines = []
        
        def extract_text_from_block(block):
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
            
            # Recursively process children blocks
            if block.get("has_children", False):
                try:
                    children_response = notion.blocks.children.list(block_id=block["id"])
                    for child_block in children_response.get("results", []):
                        extract_text_from_block(child_block)
                except Exception as e:
                    print(f"Warning: Could not fetch children for block {block.get('id')}: {e}")
        
        # Process all blocks
        for block in blocks:
            extract_text_from_block(block)
        
        lecture_text = "\n".join(text_lines)
        
        # If no text was extracted, use a fallback
        if not lecture_text.strip():
            lecture_text = f"Content from Notion page {page_id}"
        
        return (title, lecture_text)
        
    except ValueError:
        # Re-raise ValueError (which includes our custom auth error messages)
        raise
    except Exception as e:
        error_str = str(e)
        if "401" in error_str or "unauthorized" in error_str.lower():
            raise ValueError(
                "Notion API authentication failed (401 Unauthorized). "
                "Your NOTION_API_KEY is invalid or expired. "
                "Please check your integration token at https://www.notion.so/my-integrations"
            )
        raise ValueError(f"Failed to fetch Notion page {page_id}: {error_str}")


def ingest_notion_page_as_lecture(
    page_id: str,
    domain: Optional[str] = None
) -> LectureIngestResult:
    """
    Fetches a Notion page and ingests it as a lecture into the knowledge graph.
    
    This function:
    1. Fetches the Notion page using flatten_notion_page_to_text()
    2. Calls the existing POST /lectures/ingest endpoint
    3. Returns the LectureIngestResult
    
    Args:
        page_id: Notion page ID (UUID format, with or without hyphens)
        domain: Optional domain hint (defaults to "Software Engineering" if not provided)
    
    Returns:
        LectureIngestResult with created/updated nodes and links
    
    Raises:
        ValueError: If Notion API key is missing or page fetch fails
        httpx.HTTPError: If the ingestion endpoint call fails
    """
    # Flatten Notion page to text
    lecture_title, lecture_text = flatten_notion_page_to_text(page_id)
    
    # Default domain
    if domain is None:
        domain = "Software Engineering"
    
    # Prepare request payload
    payload = LectureIngestRequest(
        lecture_title=lecture_title,
        lecture_text=lecture_text,
        domain=domain,
    )
    
    # Call the existing POST /lectures/ingest endpoint
    url = f"{BRAINWEB_API_BASE}/lectures/ingest"
    
    try:
        with httpx.Client(timeout=300.0) as client:  # 5 minute timeout for LLM processing
            response = client.post(
                url,
                json=payload.model_dump(),
                headers={"Content-Type": "application/json"},
            )
            response.raise_for_status()
            result_data = response.json()
            return LectureIngestResult(**result_data)
    except httpx.HTTPStatusError as e:
        error_text = e.response.text if e.response else "Unknown error"
        raise ValueError(f"Failed to ingest lecture via API: {e.response.status_code} - {error_text}")
    except httpx.RequestError as e:
        raise ValueError(f"Failed to connect to ingestion endpoint at {url}: {str(e)}")
