# PDF Ingestion Guide

## Overview

Brain Web can now ingest PDF files directly into the knowledge graph! When you upload a PDF, the system:

1. **Extracts text and metadata** from the PDF (title, author, dates, etc.)
2. **Extracts concepts and relationships** using LLM (names, dates, locations, connections)
3. **Creates chunks and claims** for evidence-based retrieval
4. **Builds a traversable graph** you can explore and chat with

## API Endpoint

### `POST /pdf/ingest`

Ingest a PDF file into the knowledge graph.

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Endpoint: `/pdf/ingest`

**Form Parameters:**
- `file` (required): PDF file to upload
- `domain` (optional): Domain/category (e.g., "Research", "Legal", "Academic")
- `use_ocr` (optional, default: false): Enable OCR for scanned PDFs
- `extract_tables` (optional, default: true): Extract tables as structured text
- `extract_concepts` (optional, default: true): Extract concepts and relationships using LLM
- `extract_claims` (optional, default: true): Extract claims and evidence

**Response:**
```json
{
  "status": "COMPLETED",
  "artifact_id": "ART_abc123",
  "run_id": "RUN_xyz789",
  "concepts_created": 15,
  "concepts_updated": 2,
  "links_created": 23,
  "chunks_created": 45,
  "claims_created": 67,
  "page_count": 10,
  "extraction_method": "pdfplumber",
  "warnings": [],
  "errors": []
}
```

## Usage Examples

### Using cURL

```bash
curl -X POST "http://localhost:8000/pdf/ingest" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@document.pdf" \
  -F "domain=Research" \
  -F "extract_concepts=true" \
  -F "extract_claims=true"
```

### Using Python

```python
import requests

url = "http://localhost:8000/pdf/ingest"
with open("document.pdf", "rb") as f:
    files = {"file": ("document.pdf", f, "application/pdf")}
    data = {
        "domain": "Research",
        "extract_concepts": "true",
        "extract_claims": "true",
    }
    response = requests.post(url, files=files, data=data)
    print(response.json())
```

### Using the Test Script

```bash
cd backend
python test_pdf_ingest_api.py document.pdf --domain "Research"
python test_pdf_ingest_api.py scanned.pdf --use-ocr
```

## What Gets Extracted

### 1. Metadata
- Title, Author, Subject
- Creation and modification dates
- Page count
- Detection of tables and images
- Scanned PDF detection

### 2. Concepts & Relationships
The LLM extracts:
- **Entities**: Names, organizations, locations
- **Concepts**: Key ideas, topics, themes
- **Relationships**: Connections between entities/concepts
- **Dates**: Temporal information
- **Relationships**: Who knows whom, what relates to what

### 3. Chunks & Claims
- Text chunks with page references
- Evidence-backed claims
- Links to source concepts

## After Ingestion

Once ingested, you can:

1. **View the Graph**: Navigate to the graph visualization to see concepts and relationships
2. **Chat with PDF**: Ask questions about the PDF content using the chat interface
3. **Explore Concepts**: Click on nodes to see details, evidence, and connections
4. **Follow Relationships**: Traverse the graph to discover connections

## Example Chat Queries

After ingesting a PDF, try asking:

- "What are the main concepts in this document?"
- "Who are the key people mentioned?"
- "What relationships exist between X and Y?"
- "What happened on [date]?"
- "Summarize the key points about [topic]"

## Troubleshooting

### PDF extraction yields little text
- Enable OCR: `use_ocr=true`
- Check if PDF is scanned/image-based
- Verify PDF is not corrupted

### No concepts extracted
- Ensure `extract_concepts=true`
- Check that PDF has substantial text content
- Verify OpenAI API key is configured

### Slow ingestion
- Large PDFs may take several minutes
- Consider splitting very large PDFs
- Check backend logs for errors

## Integration Flow

```
PDF Upload
    ↓
Enhanced PDF Extraction (pdfplumber/PyMuPDF/PyPDF2/OCR)
    ↓
Text + Metadata Extraction
    ↓
Ingestion Kernel (unified ingestion)
    ↓
LLM Concept Extraction (GPT-4o-mini)
    ↓
Graph Creation (Neo4j)
    ↓
Chunk & Claims Extraction
    ↓
Ready for Chat & Exploration
```

## Next Steps

After ingesting PDFs, you can:
- Build learning paths through concepts
- Generate quizzes from concepts
- Track understanding and mastery
- Get adaptive recommendations

See the roadmap for upcoming features!
