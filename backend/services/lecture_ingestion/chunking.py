"""
Chunk text and normalize names for lecture ingestion.
"""
from typing import List, Dict, Any


def normalize_name(name: str) -> str:
    """Normalize concept name for comparison (lowercase, strip whitespace)"""
    return name.strip().lower()


def chunk_text(text: str, max_chars: int = 1200, overlap: int = 150) -> List[Dict[str, Any]]:
    """
    Chunk text into overlapping segments.

    Args:
        text: Full text to chunk
        max_chars: Maximum characters per chunk
        overlap: Number of characters to overlap between chunks

    Returns:
        List of dicts with 'text' and 'index' fields
    """
    if not text:
        return []

    chunks = []
    start = 0
    index = 0

    while start < len(text):
        end = start + max_chars

        if end < len(text):
            boundary_chars = [".", "\n", "!", "?"]
            for i in range(end, max(start + max_chars - 200, start), -1):
                if text[i] in boundary_chars:
                    end = i + 1
                    break
            else:
                for i in range(end, max(start + max_chars - 100, start), -1):
                    if text[i] == " ":
                        end = i + 1
                        break

        chunk_text_content = text[start:end].strip()
        if chunk_text_content:
            chunks.append({"text": chunk_text_content, "index": index})
            index += 1

        start = end - overlap
        if start >= len(text):
            break

    return chunks
