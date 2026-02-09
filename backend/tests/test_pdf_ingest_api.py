"""
Test script for PDF ingestion API endpoint.

Usage:
    python test_pdf_ingest_api.py <path_to_pdf_file> [--domain DOMAIN] [--use-ocr]

Example:
    python test_pdf_ingest_api.py document.pdf --domain "Research"
    python test_pdf_ingest_api.py scanned.pdf --use-ocr
"""
import sys
import os
import requests
import argparse

def test_pdf_ingestion(pdf_path: str, base_url: str = "http://localhost:8000", domain: str = None, use_ocr: bool = False):
    """Test PDF ingestion via API."""
    if not os.path.exists(pdf_path):
        print(f"❌ Error: File not found: {pdf_path}")
        return False
    
    url = f"{base_url}/pdf/ingest"
    
    print(f"\n{'='*60}")
    print(f"Testing PDF Ingestion API")
    print(f"{'='*60}")
    print(f"PDF: {pdf_path}")
    print(f"Size: {os.path.getsize(pdf_path) / 1024:.2f} KB")
    print(f"Endpoint: {url}")
    print(f"Domain: {domain or 'General'}")
    print(f"OCR: {use_ocr}")
    print(f"{'='*60}\n")
    
    try:
        with open(pdf_path, 'rb') as f:
            files = {'file': (os.path.basename(pdf_path), f, 'application/pdf')}
            data = {
                'domain': domain or '',
                'use_ocr': str(use_ocr).lower(),
                'extract_tables': 'true',
                'extract_concepts': 'true',
                'extract_claims': 'true',
            }
            
            print("📤 Uploading PDF and ingesting into graph...")
            response = requests.post(url, files=files, data=data, timeout=300)
        
        if response.status_code == 200:
            result = response.json()
            print(f"\n✅ PDF ingested successfully!")
            print(f"\n📊 Results:")
            print(f"   Status: {result.get('status')}")
            print(f"   Artifact ID: {result.get('artifact_id')}")
            print(f"   Run ID: {result.get('run_id')}")
            print(f"   Pages: {result.get('page_count')}")
            print(f"   Extraction Method: {result.get('extraction_method')}")
            print(f"\n📈 Graph Statistics:")
            print(f"   Concepts Created: {result.get('concepts_created', 0)}")
            print(f"   Concepts Updated: {result.get('concepts_updated', 0)}")
            print(f"   Relationships Created: {result.get('links_created', 0)}")
            print(f"   Chunks Created: {result.get('chunks_created', 0)}")
            print(f"   Claims Created: {result.get('claims_created', 0)}")
            
            if result.get('warnings'):
                print(f"\n⚠️  Warnings ({len(result['warnings'])}):")
                for warning in result['warnings'][:5]:
                    print(f"   - {warning}")
            
            if result.get('errors'):
                print(f"\n❌ Errors ({len(result['errors'])}):")
                for error in result['errors']:
                    print(f"   - {error}")
            
            print(f"\n💡 Next Steps:")
            print(f"   1. View the graph at: http://localhost:3000")
            print(f"   2. Chat with your PDF: Use the chat interface")
            print(f"   3. Explore concepts: Click on nodes in the graph")
            
            return True
        else:
            print(f"\n❌ Error: {response.status_code}")
            try:
                error_data = response.json()
                print(f"   Detail: {error_data.get('detail', 'Unknown error')}")
            except:
                print(f"   Response: {response.text[:500]}")
            return False
            
    except requests.exceptions.ConnectionError:
        print(f"\n❌ Error: Could not connect to {base_url}")
        print(f"   Make sure the backend server is running:")
        print(f"   cd backend && uvicorn main:app --reload")
        return False
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test PDF ingestion API")
    parser.add_argument("pdf_path", help="Path to PDF file")
    parser.add_argument("--url", default="http://localhost:8000", help="Backend API URL")
    parser.add_argument("--domain", help="Domain/category for the PDF")
    parser.add_argument("--use-ocr", action="store_true", help="Enable OCR for scanned PDFs")
    
    args = parser.parse_args()
    
    success = test_pdf_ingestion(
        args.pdf_path,
        base_url=args.url,
        domain=args.domain,
        use_ocr=args.use_ocr
    )
    
    sys.exit(0 if success else 1)
