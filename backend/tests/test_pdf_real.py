"""
Quick test script to verify PDF processing works with a real PDF file.
Run: python test_pdf_real.py <path_to_pdf_file>
"""
import sys
import os
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services_pdf_enhanced import extract_pdf_enhanced
from models import PDFExtractionResult


def test_pdf_extraction(pdf_path: str):
    """Test PDF extraction with a real file."""
    print(f"\n{'='*60}")
    print(f"Testing PDF extraction: {pdf_path}")
    print(f"{'='*60}\n")
    
    if not os.path.exists(pdf_path):
        print(f"❌ Error: File not found: {pdf_path}")
        return False
    
    print(f"📄 File size: {os.path.getsize(pdf_path) / 1024:.2f} KB")
    
    try:
        # Test enhanced extraction
        print("\n🔍 Extracting PDF with enhanced processing...")
        result = extract_pdf_enhanced(
            pdf_path=pdf_path,
            use_ocr=False,
            extract_tables=True,
        )
        
        print(f"\n✅ Extraction completed!")
        print(f"   Method: {result.extraction_method}")
        print(f"   Pages: {result.metadata.page_count}")
        print(f"   Text length: {len(result.full_text)} characters")
        print(f"   Is scanned: {result.metadata.is_scanned}")
        print(f"   Has tables: {result.metadata.has_tables}")
        print(f"   Has images: {result.metadata.has_images}")
        
        if result.metadata.title:
            print(f"   Title: {result.metadata.title}")
        if result.metadata.author:
            print(f"   Author: {result.metadata.author}")
        if result.metadata.creation_date:
            print(f"   Created: {result.metadata.creation_date}")
        
        if result.warnings:
            print(f"\n⚠️  Warnings ({len(result.warnings)}):")
            for warning in result.warnings[:3]:
                print(f"   - {warning}")
        
        if result.errors:
            print(f"\n❌ Errors ({len(result.errors)}):")
            for error in result.errors:
                print(f"   - {error}")
        
        # Show sample text
        if result.full_text:
            sample = result.full_text[:500].replace('\n', ' ')
            print(f"\n📝 Sample text (first 500 chars):")
            print(f"   {sample}...")
        
        # Test chunking
        print(f"\n🔪 Testing page-aware chunking...")
        from services_pdf_enhanced import chunk_pdf_with_page_references
        chunks = chunk_pdf_with_page_references(result, max_chars=500, overlap=50)
        print(f"   Created {len(chunks)} chunks")
        if chunks:
            print(f"   First chunk page numbers: {chunks[0].get('page_numbers', [])}")
            print(f"   First chunk page range: {chunks[0].get('page_range', 'N/A')}")
        
        return True
        
    except Exception as e:
        print(f"\n❌ Error during extraction: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_pdf_real.py <path_to_pdf_file>")
        print("\nExample:")
        print("  python test_pdf_real.py ~/Documents/sample.pdf")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    success = test_pdf_extraction(pdf_path)
    sys.exit(0 if success else 1)
