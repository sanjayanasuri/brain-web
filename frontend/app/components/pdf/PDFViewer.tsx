'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ingestPDFStream, type PDFIngestResponse } from '../../api-client';

interface PDFViewerProps {
  file: File;
  domain?: string;
  useOcr?: boolean;
  extractTables?: boolean;
  extractConcepts?: boolean;
  extractClaims?: boolean;
  onComplete?: (result: PDFIngestResponse) => void;
  onError?: (error: Error) => void;
}

interface ExtractionItem {
  type: 'concept' | 'name' | 'date' | 'relationship' | 'claim';
  name: string;
  value?: string;
  description?: string;
  source?: string;
  page?: number;
  confidence?: number;
}

interface StreamEvent {
  type: 'progress' | 'page_extracted' | 'extraction' | 'complete' | 'error';
  stage?: string;
  message?: string;
  progress?: number;
  page_number?: number;
  total_pages?: number;
  text_preview?: string;
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
  // Extraction event fields
  extraction_type?: 'concept' | 'name' | 'date';
  name?: string;
  node_type?: string;
  action?: 'created' | 'updated';
  description?: string;
  page?: number;
}

export default function PDFViewer({
  file,
  domain,
  useOcr = false,
  extractTables = true,
  extractConcepts = true,
  extractClaims = true,
  onComplete,
  onError,
}: PDFViewerProps) {
  const router = useRouter();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [extractions, setExtractions] = useState<ExtractionItem[]>([]);
  const [highlightedPages, setHighlightedPages] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [finalResult, setFinalResult] = useState<PDFIngestResponse | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const pdfContainerRef = useRef<HTMLDivElement>(null);

  // Create object URL for PDF display
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPdfUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Start streaming ingestion
  useEffect(() => {
    let cancelled = false;

    async function startIngestion() {
      setIsProcessing(true);
      setExtractions([]);
      setHighlightedPages(new Set());

      try {
        const stream = ingestPDFStream(file, {
          domain,
          use_ocr: useOcr,
          extract_tables: extractTables,
          extract_concepts: extractConcepts,
          extract_claims: extractClaims,
        });

        for await (const event of stream) {
          if (cancelled) break;

          const evt = event as StreamEvent;

          if (evt.type === 'error') {
            throw new Error(evt.message || 'Unknown error occurred');
          }

          if (evt.type === 'progress') {
            setProgress(evt.progress || 0);
            setStage(evt.stage || '');
          }

          if (evt.type === 'page_extracted') {
            setTotalPages(evt.total_pages || 0);
            setHighlightedPages(prev => new Set([...prev, evt.page_number || 0]));
          }

          if (evt.type === 'extraction') {
            // Handle real-time extraction events from backend
            const extractionType = evt.extraction_type || 'concept';
            const extractionItem: ExtractionItem = {
              type: extractionType as 'concept' | 'name' | 'date',
              name: evt.name || '',
              description: evt.description,
              page: evt.page,
            };
            setExtractions(prev => [...prev, extractionItem]);
            
            // Highlight page if page number is available
            if (evt.page) {
              setHighlightedPages(prev => new Set([...prev, evt.page!]));
            }
          }

          if (evt.type === 'complete') {
            setProgress(100);
            setIsProcessing(false);
            setIsComplete(true);
            
            const result: PDFIngestResponse = {
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
            
            setFinalResult(result);
            setShowConfirmDialog(true);
          }
        }
      } catch (error) {
        if (!cancelled) {
          const err = error instanceof Error ? error : new Error('Unknown error');
          setIsProcessing(false);
          onError?.(err);
        }
      }

      return () => {
        cancelled = true;
      };
    }

    startIngestion();
  }, [file, domain, useOcr, extractTables, extractConcepts, extractClaims, onError]);

  const handleConfirm = async () => {
    setIsConfirming(true);
    try {
      if (finalResult) {
        onComplete?.(finalResult);
        // Navigate to graph with the run_id highlighted
        if (finalResult.run_id) {
          router.push(`/?highlight_run_id=${encodeURIComponent(finalResult.run_id)}`);
        } else {
          router.push('/');
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to confirm');
      onError?.(err);
    } finally {
      setIsConfirming(false);
    }
  };

  const handleCancel = () => {
    setShowConfirmDialog(false);
    // User can stay on the page to review, or navigate away manually
  };

  const handleViewInGraph = () => {
    if (finalResult?.run_id) {
      router.push(`/?highlight_run_id=${encodeURIComponent(finalResult.run_id)}`);
    } else {
      router.push('/');
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
      height: 'calc(100vh - 100px)',
      gap: '20px',
      background: 'var(--page-bg)',
    }}>
      {/* Left: PDF Viewer */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--panel)',
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: 'var(--shadow)',
      }}>
        {/* PDF Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '4px' }}>
              {file.name}
            </h2>
            {isProcessing && (
              <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                {stage} • {progress}%
              </div>
            )}
            {isComplete && (
              <div style={{ fontSize: '12px', color: '#22c55e' }}>
                Extraction complete
              </div>
            )}
          </div>
          {totalPages > 0 && (
            <div style={{ fontSize: '14px', color: 'var(--muted)' }}>
              Page {currentPage} of {totalPages}
            </div>
          )}
        </div>

        {/* PDF Content */}
        <div
          ref={pdfContainerRef}
          style={{
            flex: 1,
            overflow: 'auto',
            display: 'flex',
            justifyContent: 'center',
            padding: '20px',
            background: '#525252',
          }}
        >
          {pdfUrl ? (
            <div style={{ position: 'relative' }}>
              <object
                data={pdfUrl}
                type="application/pdf"
                style={{
                  width: '100%',
                  minWidth: '600px',
                  height: 'auto',
                  border: 'none',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                }}
              >
                <div style={{
                  padding: '40px',
                  textAlign: 'center',
                  color: 'white',
                }}>
                  <p>PDF preview not available in your browser.</p>
                  <a
                    href={pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: '10px 20px',
                      fontSize: '14px',
                      background: 'var(--accent)',
                      color: 'white',
                      textDecoration: 'none',
                      borderRadius: '6px',
                      display: 'inline-block',
                      marginTop: '16px',
                    }}
                  >
                    Open PDF
                  </a>
                </div>
              </object>
              
              {/* Highlight overlay for processing pages */}
              {highlightedPages.size > 0 && (
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  pointerEvents: 'none',
                }}>
                  {Array.from(highlightedPages).map(pageNum => (
                    <div
                      key={pageNum}
                      style={{
                        position: 'absolute',
                        top: `${((pageNum - 1) / totalPages) * 100}%`,
                        left: 0,
                        right: 0,
                        height: `${(1 / totalPages) * 100}%`,
                        background: 'rgba(37, 99, 235, 0.1)',
                        border: '2px solid rgba(37, 99, 235, 0.3)',
                        borderRadius: '4px',
                        transition: 'all 0.3s',
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: '40px', textAlign: 'center', color: 'white' }}>
              Loading PDF...
            </div>
          )}
        </div>

        {/* Progress Bar */}
        {isProcessing && (
          <div style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface)',
          }}>
            <div style={{
              width: '100%',
              height: '6px',
              background: '#e5e7eb',
              borderRadius: '3px',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${progress}%`,
                height: '100%',
                background: 'var(--accent)',
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        )}
      </div>

      {/* Right: Extractions Sidebar */}
      <div style={{
        width: '400px',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--panel)',
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: 'var(--shadow)',
      }}>
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px' }}>
            Extractions
          </h3>
          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
            {extractions.length} items extracted
          </div>
        </div>

        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '16px',
        }}>
          {/* Concepts */}
          {groupedExtractions.concepts.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <div style={{
                fontSize: '13px',
                fontWeight: '600',
                color: 'var(--accent)',
                marginBottom: '8px',
              }}>
                Concepts ({groupedExtractions.concepts.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {groupedExtractions.concepts.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '8px 12px',
                      background: 'var(--surface)',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      fontSize: '13px',
                    }}
                  >
                    <div style={{ fontWeight: '500', marginBottom: '4px' }}>
                      {item.name}
                    </div>
                    {item.description && (
                      <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                        {item.description}
                      </div>
                    )}
                    {item.page && (
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                        Page {item.page}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Names */}
          {groupedExtractions.names.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <div style={{
                fontSize: '13px',
                fontWeight: '600',
                color: '#8b5cf6',
                marginBottom: '8px',
              }}>
                Names ({groupedExtractions.names.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {groupedExtractions.names.map((item, idx) => (
                  <span
                    key={idx}
                    style={{
                      padding: '4px 10px',
                      background: 'rgba(139, 92, 246, 0.1)',
                      borderRadius: '12px',
                      fontSize: '12px',
                      color: '#8b5cf6',
                    }}
                  >
                    {item.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Dates */}
          {groupedExtractions.dates.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <div style={{
                fontSize: '13px',
                fontWeight: '600',
                color: '#f59e0b',
                marginBottom: '8px',
              }}>
                Dates ({groupedExtractions.dates.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {groupedExtractions.dates.map((item, idx) => (
                  <span
                    key={idx}
                    style={{
                      padding: '4px 10px',
                      background: 'rgba(245, 158, 11, 0.1)',
                      borderRadius: '12px',
                      fontSize: '12px',
                      color: '#f59e0b',
                    }}
                  >
                    {item.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Relationships */}
          {groupedExtractions.relationships.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <div style={{
                fontSize: '13px',
                fontWeight: '600',
                color: '#10b981',
                marginBottom: '8px',
              }}>
                Relationships ({groupedExtractions.relationships.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {groupedExtractions.relationships.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '8px 12px',
                      background: 'var(--surface)',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      fontSize: '12px',
                    }}
                  >
                    {item.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Claims */}
          {groupedExtractions.claims.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <div style={{
                fontSize: '13px',
                fontWeight: '600',
                color: '#ef4444',
                marginBottom: '8px',
              }}>
                Claims ({groupedExtractions.claims.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {groupedExtractions.claims.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '8px 12px',
                      background: 'var(--surface)',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      fontSize: '12px',
                    }}
                  >
                    {item.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {extractions.length === 0 && (
            <div style={{
              padding: '40px 20px',
              textAlign: 'center',
              color: 'var(--muted)',
              fontSize: '14px',
            }}>
              {isProcessing ? (
                <>
                  <div style={{ marginBottom: '8px' }}>Extracting content...</div>
                  <div style={{ fontSize: '12px', opacity: 0.7 }}>
                    Extractions will appear here as they're processed
                  </div>
                </>
              ) : isComplete ? (
                <>
                  <div style={{ marginBottom: '8px' }}>Extraction complete</div>
                  <div style={{ fontSize: '12px', opacity: 0.7 }}>
                    View the summary below or navigate to the graph to see all extracted concepts and relationships
                  </div>
                </>
              ) : (
                'No extractions yet'
              )}
            </div>
          )}
        </div>

        {/* Summary Footer */}
        {isComplete && finalResult && (
          <div style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface)',
          }}>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>
              Summary
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' }}>
              <div>Concepts: {finalResult.concepts_created} created</div>
              <div>Relationships: {finalResult.links_created} created</div>
              <div>Claims: {finalResult.claims_created} created</div>
              <div>Pages: {finalResult.page_count}</div>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      {showConfirmDialog && finalResult && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            padding: '24px',
            maxWidth: '500px',
            width: '90%',
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
          }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '12px' }}>
              PDF Ingestion Complete
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '20px' }}>
              The PDF has been processed and the knowledge graph has been created with:
            </p>
            <div style={{
              background: 'var(--surface)',
              padding: '16px',
              borderRadius: '8px',
              marginBottom: '20px',
              fontSize: '14px',
            }}>
              <div style={{ marginBottom: '8px' }}>
                <strong>{finalResult.concepts_created}</strong> concepts created
              </div>
              <div style={{ marginBottom: '8px' }}>
                <strong>{finalResult.links_created}</strong> relationships created
              </div>
              <div style={{ marginBottom: '8px' }}>
                <strong>{finalResult.claims_created}</strong> claims created
              </div>
              <div>
                <strong>{finalResult.chunks_created}</strong> chunks created
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={handleCancel}
                disabled={isConfirming}
                style={{
                  padding: '10px 20px',
                  background: 'transparent',
                  color: 'var(--muted)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: isConfirming ? 'not-allowed' : 'pointer',
                }}
              >
                Stay Here
              </button>
              <button
                onClick={handleViewInGraph}
                disabled={isConfirming}
                style={{
                  padding: '10px 20px',
                  background: 'var(--accent)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: isConfirming ? 'not-allowed' : 'pointer',
                  opacity: isConfirming ? 0.6 : 1,
                }}
              >
                View in Graph →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
