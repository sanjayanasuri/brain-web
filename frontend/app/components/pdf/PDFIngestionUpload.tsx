'use client';

import { useState, useRef, useEffect } from 'react';
import { ingestPDFStream, type PDFIngestResponse } from '../../api-client';

interface PDFIngestionUploadProps {
  onFileSelect?: (file: File | null) => void;
  onIngestionComplete?: (result: PDFIngestResponse) => void;
  onError?: (error: Error) => void;
  onExtractionsUpdate?: (extractions: ExtractionItem[]) => void;
  onProgressUpdate?: (progress: number, stage: string) => void;
}

export interface ExtractionItem {
  type: 'concept' | 'name' | 'date' | 'relationship' | 'claim';
  name: string;
  description?: string;
  page?: number;
}

interface StreamEvent {
  type: 'progress' | 'page_extracted' | 'extraction' | 'complete' | 'error';
  stage?: string;
  message?: string;
  progress?: number;
  page_number?: number;
  total_pages?: number;
  extraction_type?: 'concept' | 'name' | 'date';
  name?: string;
  description?: string;
  page?: number;
  status?: string;
  artifact_id?: string;
  run_id?: string;
  concepts_created?: number;
  concepts_updated?: number;
  links_created?: number;
  chunks_created?: number;
  claims_created?: number;
  page_count?: number;
  extraction_method?: string;
  warnings?: string[];
  errors?: string[];
}

export default function PDFIngestionUpload({
  onFileSelect,
  onIngestionComplete,
  onError,
  onExtractionsUpdate,
  onProgressUpdate,
}: PDFIngestionUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [domain, setDomain] = useState('');
  const [useOcr, setUseOcr] = useState(false);
  const [extractTables, setExtractTables] = useState(true);
  const [extractConcepts, setExtractConcepts] = useState(true);
  const [extractClaims, setExtractClaims] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string>('');
  const [extractions, setExtractions] = useState<ExtractionItem[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Sync extractions to parent component via useEffect to avoid render-phase updates
  useEffect(() => {
    onExtractionsUpdate?.(extractions);
  }, [extractions, onExtractionsUpdate]);

  const handleFileSelect = (selectedFile: File) => {
    if (selectedFile.type !== 'application/pdf') {
      alert('Please select a PDF file');
      return;
    }
    setFile(selectedFile);
    onFileSelect?.(selectedFile);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      alert('Please select a PDF file');
      return;
    }

    setIsUploading(true);
    setExtractions([]);
    setProgress(0);
    setStage('Initializing...');
    setTotalPages(0);
    onProgressUpdate?.(0, 'Initializing...');

    try {
      console.log('Starting PDF ingestion stream...', { file: file.name, domain, extractConcepts, extractClaims });
      const stream = ingestPDFStream(file, {
        domain: domain || undefined,
        use_ocr: useOcr,
        extract_tables: extractTables,
        extract_concepts: extractConcepts,
        extract_claims: extractClaims,
      });

      let finalResult: PDFIngestResponse | null = null;

      for await (const event of stream) {
        console.log('Received stream event:', event);
        const evt = event as StreamEvent;

        if (evt.type === 'error') {
          throw new Error(evt.message || 'Unknown error occurred');
        }

        if (evt.type === 'progress') {
          setProgress(evt.progress || 0);
          setStage(evt.stage || '');
          onProgressUpdate?.(evt.progress || 0, evt.stage || '');
        }

        if (evt.type === 'page_extracted') {
          setTotalPages(evt.total_pages || 0);
        }

        if (evt.type === 'extraction') {
          const extractionType = evt.extraction_type || 'concept';
          const extractionItem: ExtractionItem = {
            type: extractionType as 'concept' | 'name' | 'date',
            name: evt.name || '',
            description: evt.description,
            page: evt.page,
          };
          setExtractions(prev => [...prev, extractionItem]);
        }

        if (evt.type === 'complete') {
          setProgress(100);
          finalResult = {
            status: evt.status || 'COMPLETED',
            artifact_id: evt.artifact_id || null,
            run_id: evt.run_id || null,
            concepts_created: evt.concepts_created || 0,
            concepts_updated: evt.concepts_updated || 0,
            links_created: evt.links_created || 0,
            chunks_created: evt.chunks_created || 0,
            claims_created: evt.claims_created || 0,
            page_count: evt.page_count || 0,
            extraction_method: evt.extraction_method || null,
            warnings: evt.warnings || [],
            errors: evt.errors || [],
          };
          
          onIngestionComplete?.(finalResult);
          
          // Reset form after success
          setTimeout(() => {
            setFile(null);
            onFileSelect?.(null);
            setDomain('');
            setUseOcr(false);
            setExtractions([]);
            setProgress(0);
            setStage('');
            if (fileInputRef.current) {
              fileInputRef.current.value = '';
            }
          }, 3000);
        }
      }
    } catch (error) {
      console.error('PDF ingestion error:', error);
      const err = error instanceof Error ? error : new Error('Unknown error');
      setIsUploading(false);
      setProgress(0);
      setStage('');
      onError?.(err);
    }
  };

  const groupedExtractions = {
    concepts: extractions.filter(e => e.type === 'concept'),
    names: extractions.filter(e => e.type === 'name'),
    dates: extractions.filter(e => e.type === 'date'),
    relationships: extractions.filter(e => e.type === 'relationship'),
    claims: extractions.filter(e => e.type === 'claim'),
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
    }}>
      {/* Compact Drop Zone */}
      <div
        ref={dropZoneRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          border: `2px dashed ${isDragging ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: '8px',
          padding: '16px 20px',
          background: isDragging ? 'rgba(37, 99, 235, 0.05)' : 'transparent',
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          onChange={handleFileInputChange}
          disabled={isUploading}
          style={{ display: 'none' }}
        />
        <div style={{ fontSize: '24px' }}>📄</div>
        {file ? (
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
              {file.name}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
              {(file.size / 1024).toFixed(2)} KB
            </div>
          </div>
        ) : (
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
              Drop PDF here or click to select
            </div>
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
              Select a PDF file to upload
            </div>
          </div>
        )}
        {file && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setFile(null);
              onFileSelect?.(null);
              if (fileInputRef.current) {
                fileInputRef.current.value = '';
              }
            }}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              color: 'var(--muted)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Change
          </button>
        )}
      </div>

      {/* Upload Button and Progress - Compact */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}>
        <button
          onClick={handleUpload}
          disabled={!file || isUploading}
          style={{
            padding: '10px 20px',
            background: file && !isUploading ? 'var(--accent)' : '#9ca3af',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: file && !isUploading ? 'pointer' : 'not-allowed',
            transition: 'background 0.2s',
            flexShrink: 0,
          }}
        >
          {isUploading ? 'Ingesting...' : 'Ingest PDF'}
        </button>

        {/* Compact Progress */}
        {isUploading && (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}>
            <div style={{
              flex: 1,
              height: '8px',
              background: '#e5e7eb',
              borderRadius: '4px',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${progress}%`,
                height: '100%',
                background: 'var(--accent)',
                transition: 'width 0.3s ease',
                borderRadius: '4px',
              }} />
            </div>
            <div style={{
              fontSize: '12px',
              color: 'var(--muted)',
              minWidth: '80px',
              textAlign: 'right',
            }}>
              {progress}%
            </div>
          </div>
        )}
      </div>

      {/* Hidden options for ingestion - these are used but not displayed */}
      <div style={{ display: 'none' }}>
        <input
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
        />
        <input
          type="checkbox"
          checked={extractConcepts}
          onChange={(e) => setExtractConcepts(e.target.checked)}
        />
        <input
          type="checkbox"
          checked={extractClaims}
          onChange={(e) => setExtractClaims(e.target.checked)}
        />
        <input
          type="checkbox"
          checked={extractTables}
          onChange={(e) => setExtractTables(e.target.checked)}
        />
        <input
          type="checkbox"
          checked={useOcr}
          onChange={(e) => setUseOcr(e.target.checked)}
        />
      </div>
    </div>
  );
}
