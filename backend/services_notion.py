"""
Service for fetching Notion pages and ingesting them as lectures into the knowledge graph

Do not call backend endpoints from backend services. Use ingestion kernel/internal services to prevent ingestion path drift.
"""
from typing import Optional, Tuple, List, Dict, Any
from notion_client import Client
import os
from neo4j import Session

from models import LectureIngestResult
from models_ingestion_kernel import ArtifactInput, IngestionActions, IngestionPolicy
from services_ingestion_kernel import ingest_artifact
from config import OPENAI_API_KEY, NOTION_API_KEY

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


def notion_blocks_to_markdown(blocks: List[Dict[str, Any]], notion: Client) -> str:
    """
    Convert Notion blocks to Markdown format, preserving structure and formatting.
    
    Args:
        blocks: List of Notion block objects
        notion: Notion client instance
    
    Returns:
        Markdown string representation of the blocks
    """
    markdown_lines = []
    
    def rich_text_to_markdown(rich_text: List[Dict[str, Any]]) -> str:
        """Convert Notion rich_text array to markdown with formatting."""
        result = []
        for item in rich_text:
            text = item.get("plain_text", "")
            annotations = item.get("annotations", {})
            href = item.get("href")
            
            # Apply formatting
            if annotations.get("bold"):
                text = f"**{text}**"
            if annotations.get("italic"):
                text = f"*{text}*"
            if annotations.get("strikethrough"):
                text = f"~~{text}~~"
            if annotations.get("code"):
                text = f"`{text}`"
            if href:
                text = f"[{text}]({href})"
            
            result.append(text)
        return "".join(result)
    
    def process_block(block: Dict[str, Any], indent_level: int = 0) -> None:
        """Recursively process a block and its children."""
        block_type = block.get("type")
        block_data = block.get(block_type, {})
        indent = "  " * indent_level
        
        if block_type == "paragraph":
            rich_text = block_data.get("rich_text", [])
            if rich_text:
                text = rich_text_to_markdown(rich_text)
                if text.strip():
                    markdown_lines.append(f"{indent}{text}")
            else:
                markdown_lines.append("")  # Empty paragraph
        
        elif block_type == "heading_1":
            rich_text = block_data.get("rich_text", [])
            text = rich_text_to_markdown(rich_text)
            markdown_lines.append(f"{indent}# {text}")
        
        elif block_type == "heading_2":
            rich_text = block_data.get("rich_text", [])
            text = rich_text_to_markdown(rich_text)
            markdown_lines.append(f"{indent}## {text}")
        
        elif block_type == "heading_3":
            rich_text = block_data.get("rich_text", [])
            text = rich_text_to_markdown(rich_text)
            markdown_lines.append(f"{indent}### {text}")
        
        elif block_type == "bulleted_list_item":
            rich_text = block_data.get("rich_text", [])
            text = rich_text_to_markdown(rich_text)
            markdown_lines.append(f"{indent}- {text}")
        
        elif block_type == "numbered_list_item":
            rich_text = block_data.get("rich_text", [])
            text = rich_text_to_markdown(rich_text)
            # Note: We can't determine the number without context, so use "-" for now
            markdown_lines.append(f"{indent}1. {text}")
        
        elif block_type == "to_do":
            rich_text = block_data.get("rich_text", [])
            checked = block_data.get("checked", False)
            text = rich_text_to_markdown(rich_text)
            checkbox = "[x]" if checked else "[ ]"
            markdown_lines.append(f"{indent}{checkbox} {text}")
        
        elif block_type == "toggle":
            rich_text = block_data.get("rich_text", [])
            text = rich_text_to_markdown(rich_text)
            markdown_lines.append(f"{indent}<details><summary>{text}</summary>")
            markdown_lines.append("")  # Empty line before content
        
        elif block_type == "code":
            rich_text = block_data.get("rich_text", [])
            language = block_data.get("language", "")
            code_text = "".join([item.get("plain_text", "") for item in rich_text])
            markdown_lines.append(f"{indent}```{language}")
            markdown_lines.append(f"{indent}{code_text}")
            markdown_lines.append(f"{indent}```")
        
        elif block_type == "quote":
            rich_text = block_data.get("rich_text", [])
            text = rich_text_to_markdown(rich_text)
            markdown_lines.append(f"{indent}> {text}")
        
        elif block_type == "callout":
            rich_text = block_data.get("rich_text", [])
            icon = block_data.get("icon", {})
            text = rich_text_to_markdown(rich_text)
            icon_emoji = icon.get("emoji", "💡") if icon else "💡"
            markdown_lines.append(f"{indent}> **{icon_emoji}** {text}")
        
        elif block_type == "divider":
            markdown_lines.append(f"{indent}---")
        
        elif block_type == "table":
            # Tables are complex, for now just extract text
            markdown_lines.append(f"{indent}*[Table]*")
        
        elif block_type == "image":
            image_data = block_data.get("file") or block_data.get("external", {})
            url = image_data.get("url", "")
            caption = block_data.get("caption", [])
            caption_text = rich_text_to_markdown(caption) if caption else ""
            if url:
                markdown_lines.append(f"{indent}![{caption_text}]({url})")
        
        elif block_type == "bookmark" or block_type == "link_preview":
            url = block_data.get("url", "")
            caption = block_data.get("caption", [])
            caption_text = rich_text_to_markdown(caption) if caption else url
            if url:
                markdown_lines.append(f"{indent}[{caption_text}]({url})")
        
        elif block_type == "transcription":
            # Transcription blocks don't support fetching children via API
            # Extract any text directly from the block
            rich_text = block_data.get("rich_text", [])
            if rich_text:
                text = rich_text_to_markdown(rich_text)
                if text.strip():
                    markdown_lines.append(f"{indent}*[Transcription]* {text}")
            else:
                # If no rich_text, just note that there's a transcription
                markdown_lines.append(f"{indent}*[Transcription block - content not accessible via API]*")
        
        else:
            # Fallback: extract any rich_text
            if "rich_text" in block_data:
                rich_text = block_data.get("rich_text", [])
                if rich_text:
                    text = rich_text_to_markdown(rich_text)
                    if text.strip():
                        markdown_lines.append(f"{indent}{text}")
        
        # Process children (skip for block types that don't support it)
        # Transcription blocks don't support fetching children via API
        unsupported_child_types = {"transcription"}
        if block.get("has_children", False) and block_type not in unsupported_child_types:
            try:
                children_response = notion.blocks.children.list(block_id=block["id"])
                for child_block in children_response.get("results", []):
                    # For toggles, increase indent for children
                    child_indent = indent_level + 1 if block_type == "toggle" else indent_level
                    process_block(child_block, child_indent)
            except Exception as e:
                error_str = str(e)
                # Check if it's a transcription or other unsupported block type
                if "transcription" in error_str.lower() or "not supported" in error_str.lower():
                    # Silently skip - we already handled transcription blocks above
                    pass
                else:
                    # For other errors, log a warning
                    print(f"Warning: Could not fetch children for block {block.get('id')} (type: {block_type}): {e}")
        
        # Close toggle/details
        if block_type == "toggle":
            markdown_lines.append(f"{indent}</details>")
    
    # Process all blocks
    for block in blocks:
        process_block(block)
    
    return "\n".join(markdown_lines)


def flatten_notion_page_to_text(page_id: str) -> Tuple[str, str, str]:
    """
    Fetches a Notion page by page_id and converts it to title, plain text, and markdown.
    
    Args:
        page_id: Notion page ID (UUID format, with or without hyphens)
    
    Returns:
        Tuple of (lecture_title, lecture_text, lecture_markdown) where:
        - lecture_title: The page title
        - lecture_text: Newline-joined plain text of all blocks (for LLM processing)
        - lecture_markdown: Markdown representation (for display in file studio)
    
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
        
        # Convert blocks to markdown (preserves formatting)
        lecture_markdown = notion_blocks_to_markdown(blocks, notion)
        
        # Also extract plain text for LLM processing
        text_lines = []
        
        def extract_text_from_block(block):
            """Recursively extract plain text from a block and its children"""
            block_type = block.get("type")
            block_data = block.get(block_type, {})
            
            # Handle transcription blocks (they don't support fetching children)
            if block_type == "transcription":
                # Extract any text directly from the transcription block
                if "rich_text" in block_data:
                    rich_text = block_data["rich_text"]
                    if rich_text:
                        text = "".join([item.get("plain_text", "") for item in rich_text])
                        if text.strip():
                            text_lines.append(f"[Transcription] {text}")
                # Skip trying to fetch children for transcription blocks
                return
            
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
            
            # Recursively process children blocks (skip for unsupported types)
            unsupported_child_types = {"transcription"}
            if block.get("has_children", False) and block_type not in unsupported_child_types:
                try:
                    children_response = notion.blocks.children.list(block_id=block["id"])
                    for child_block in children_response.get("results", []):
                        extract_text_from_block(child_block)
                except Exception as e:
                    error_str = str(e)
                    # Check if it's a transcription or other unsupported block type
                    if "transcription" in error_str.lower() or "not supported" in error_str.lower():
                        # Silently skip - transcription blocks are handled above
                        pass
                    else:
                        # For other errors, log a warning
                        print(f"Warning: Could not fetch children for block {block.get('id')} (type: {block_type}): {e}")
        
        # Process all blocks for plain text
        for block in blocks:
            extract_text_from_block(block)
        
        lecture_text = "\n".join(text_lines)
        
        # If no text was extracted, use a fallback
        if not lecture_text.strip():
            lecture_text = f"Content from Notion page {page_id}"
        if not lecture_markdown.strip():
            lecture_markdown = f"# {title}\n\n{lecture_text}"
        
        return (title, lecture_text, lecture_markdown)
        
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
    session: Session,
    page_id: str,
    domain: Optional[str] = None
) -> LectureIngestResult:
    """
    Fetches a Notion page and ingests it as a lecture into the knowledge graph.
    
    This function:
    1. Fetches the Notion page using flatten_notion_page_to_text()
    2. Calls the ingestion kernel directly
    3. Returns the LectureIngestResult
    
    Args:
        session: Neo4j session
        page_id: Notion page ID (UUID format, with or without hyphens)
        domain: Optional domain hint (defaults to "Software Engineering" if not provided)
    
    Returns:
        LectureIngestResult with created/updated nodes and links
    
    Raises:
        ValueError: If Notion API key is missing or page fetch fails
    """
    # Flatten Notion page to text and markdown
    lecture_title, lecture_text, lecture_markdown = flatten_notion_page_to_text(page_id)
    
    # Default domain
    if domain is None:
        domain = "Software Engineering"
    
    # Get Notion page URL if available
    notion_url = None
    try:
        # Try to construct a Notion URL (format: https://www.notion.so/{page_id})
        # Note: This is a best-effort attempt; actual URL might differ
        notion_url = f"https://www.notion.so/{page_id.replace('-', '')}"
    except Exception:
        pass
    
    # Build ArtifactInput for the kernel
    # Store markdown in metadata for file studio rendering
    payload = ArtifactInput(
        artifact_type="notion_page",
        source_url=notion_url,
        source_id=page_id,
        title=lecture_title,
        domain=domain,
        text=lecture_text,  # Plain text for LLM processing
        metadata={
            "notion_page_id": page_id,
            "markdown": lecture_markdown,  # Markdown for file studio display
        },
        actions=IngestionActions(
            run_lecture_extraction=True,
            run_chunk_and_claims=True,
            embed_claims=True,
            create_lecture_node=True,
            create_artifact_node=True,
        ),
        policy=IngestionPolicy(),
    )
    
    # Call the ingestion kernel directly
    try:
        result = ingest_artifact(session, payload)
        
        # Convert IngestionResult to LectureIngestResult
        if not result.lecture_id:
            raise ValueError("Ingestion completed but no lecture_id was generated")
        
        return LectureIngestResult(
            lecture_id=result.lecture_id,
            nodes_created=result.nodes_created,
            nodes_updated=result.nodes_updated,
            links_created=result.links_created,
            segments=result.segments,
            run_id=result.run_id,
            created_concept_ids=result.created_concept_ids,
            updated_concept_ids=result.updated_concept_ids,
            created_relationship_count=result.created_relationship_count,
            created_claim_ids=result.created_claim_ids,
        )
    except Exception as e:
        raise ValueError(f"Failed to ingest Notion page via kernel: {str(e)}")
