"""
AI-powered features for Resource processing.

Handles:
- Image captioning using GPT-4 Vision
- PDF text extraction and summarization
- Concept extraction from uploaded files
"""

import json
import logging
from typing import Optional
import base64
import os

from services_model_router import model_router, TASK_EXTRACT, TASK_SUMMARIZE

logger = logging.getLogger("brain_web")


def generate_image_caption(image_path: str, image_bytes: Optional[bytes] = None) -> Optional[str]:
    """
    Generate a caption for an image using GPT-4 Vision.

    Args:
        image_path: Path to image file (for local storage) or storage identifier
        image_bytes: Optional image bytes (for S3/storage abstraction)

    Returns None if OpenAI client is not available or if the API call fails.
    """
    if not model_router.client:
        return None

    try:
        # Read image data
        if image_bytes:
            image_data = base64.b64encode(image_bytes).decode('utf-8')
        else:
            with open(image_path, "rb") as image_file:
                image_data = base64.b64encode(image_file.read()).decode('utf-8')

        # Determine image format from file extension
        ext = os.path.splitext(image_path)[1].lower() if image_path else '.jpg'
        image_format_map = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
        }
        image_format = image_format_map.get(ext, 'image/jpeg')

        caption = model_router.completion(
            task_type=TASK_EXTRACT,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Describe this image in 1-2 sentences. Focus on what concepts, diagrams, or information it contains that would be useful for a knowledge graph.",
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{image_format};base64,{image_data}"},
                        },
                    ],
                }
            ],
            max_tokens=200,
            temperature=0.3,
        )
        return caption.strip() if caption else None

    except Exception as e:
        logger.error(f"Error generating image caption: {e}")
        return None


def extract_pdf_text(pdf_path: str, pdf_bytes: Optional[bytes] = None) -> Optional[str]:
    """
    Extract text from a PDF file.

    Args:
        pdf_path: Path to PDF file (for local storage) or storage identifier
        pdf_bytes: Optional PDF bytes (for S3/storage abstraction)

    Returns None if extraction fails.
    """
    try:
        import PyPDF2
        import io

        if pdf_bytes:
            pdf_file = io.BytesIO(pdf_bytes)
            pdf_reader = PyPDF2.PdfReader(pdf_file)
        else:
            with open(pdf_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)

        text_parts = []
        for page_num, page in enumerate(pdf_reader.pages):
            try:
                text = page.extract_text()
                if text:
                    text_parts.append(text)
            except Exception as e:
                logger.warning(f"Error extracting text from page {page_num + 1}: {e}")
                continue

        full_text = "\n\n".join(text_parts)
        return full_text if full_text.strip() else None

    except ImportError:
        logger.error("PyPDF2 not installed. Install with: pip install PyPDF2")
        return None
    except Exception as e:
        logger.error(f"Error extracting PDF text: {e}")
        return None


def summarize_pdf_text(text: str) -> Optional[str]:
    """
    Generate a summary/caption for PDF text using LLM.

    Returns None if OpenAI client is not available or if the API call fails.
    """
    if not model_router.client:
        return None

    try:
        max_chars = 8000
        if len(text) > max_chars:
            text = text[:max_chars] + "..."

        summary = model_router.completion(
            task_type=TASK_SUMMARIZE,
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that summarizes documents. Create a concise 1-2 sentence summary focusing on key concepts and information that would be useful for a knowledge graph.",
                },
                {
                    "role": "user",
                    "content": f"Summarize this document:\n\n{text}",
                },
            ],
            max_tokens=200,
            temperature=0.3,
        )
        return summary.strip() if summary else None

    except Exception as e:
        logger.error(f"Error summarizing PDF text: {e}")
        return None


def extract_concepts_from_text(text: str) -> Optional[list]:
    """
    Extract key concepts mentioned in text using LLM.

    Returns a list of concept names, or None if extraction fails.
    This can be used to suggest which concepts to link the resource to.
    """
    if not model_router.client:
        return None

    try:
        max_chars = 4000
        if len(text) > max_chars:
            text = text[:max_chars] + "..."

        raw = model_router.completion(
            task_type=TASK_EXTRACT,
            messages=[
                {
                    "role": "system",
                    "content": 'You are a helpful assistant that extracts key concepts from text. Return a JSON array of concept names (strings) that are mentioned in the text. Focus on technical concepts, tools, frameworks, or important ideas.',
                },
                {
                    "role": "user",
                    "content": f'Extract key concepts from this text:\n\n{text}\n\nReturn only a JSON array of concept names, e.g. ["Docker", "Microservices", "API Gateway"]',
                },
            ],
            max_tokens=300,
            temperature=0.2,
        )

        concepts_str = (raw or "").strip()
        if concepts_str.startswith('```'):
            concepts_str = concepts_str.split('```')[1]
            if concepts_str.startswith('json'):
                concepts_str = concepts_str[4:]
        concepts_str = concepts_str.strip()

        concepts = json.loads(concepts_str)
        return concepts if isinstance(concepts, list) else None

    except Exception as e:
        logger.error(f"Error extracting concepts from text: {e}")
        return None
