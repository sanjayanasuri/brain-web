'use client';

import { useEffect, useState } from 'react';
import { getGraphFiles, GraphFile, GraphFilesResponse, previewGraphFile, downloadGraphFile, triggerExport, FilePreviewResponse } from '../../api-client';

export default function GraphFilesViewer({ className = '' }: { className?: string }) {
  const [files, setFiles] = useState<GraphFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<{ total_files: number; total_size_formatted: string; graph_dir?: string } | null>(null);
  const [expandedPreviews, setExpandedPreviews] = useState<Set<string>>(new Set());
  const [previewData, setPreviewData] = useState<Map<string, FilePreviewResponse>>(new Map());
  const [loadingPreviews, setLoadingPreviews] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const loadFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const data: GraphFilesResponse = await getGraphFiles();
      if (data.status === 'ok') {
        setFiles(data.files);
        setFileInfo({
          total_files: data.total_files,
          total_size_formatted: data.total_size_formatted,
          graph_dir: data.graph_dir,
        });
      } else {
        setError(data.message || 'Failed to load graph files');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph files');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFiles();
  }, []);

  const togglePreview = async (filename: string) => {
    if (expandedPreviews.has(filename)) {
      // Collapse
      setExpandedPreviews(prev => {
        const next = new Set(prev);
        next.delete(filename);
        return next;
      });
    } else {
      // Expand - load preview if not already loaded
      setExpandedPreviews(prev => new Set(prev).add(filename));
      
      if (!previewData.has(filename)) {
        setLoadingPreviews(prev => new Set(prev).add(filename));
        try {
          const preview = await previewGraphFile(filename, 10);
          setPreviewData(prev => new Map(prev).set(filename, preview));
        } catch (err) {
          console.error('Failed to load preview:', err);
        } finally {
          setLoadingPreviews(prev => {
            const next = new Set(prev);
            next.delete(filename);
            return next;
          });
        }
      }
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      await triggerExport(true);
      // Reload files after export
      setTimeout(() => {
        loadFiles();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger export');
    } finally {
      setExporting(false);
    }
  };

  const handleDownload = (filename: string) => {
    downloadGraphFile(filename);
  };

  if (loading) {
    return (
      <div className={`graph-files-viewer ${className}`} style={{
        padding: '20px',
        background: 'var(--bg-secondary, #f5f5f5)',
        borderRadius: '8px',
        border: '1px solid var(--border, #e0e0e0)',
      }}>
        <div style={{ textAlign: 'center', color: 'var(--muted, #666)' }}>Loading graph files...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`graph-files-viewer ${className}`} style={{
        padding: '20px',
        background: 'var(--bg-secondary, #f5f5f5)',
        borderRadius: '8px',
        border: '1px solid var(--border, #e0e0e0)',
      }}>
        <div className="chat-error">{error}</div>
      </div>
    );
  }

  const recentlyChangedCount = files.filter(f => f.recently_changed).length;

  return (
    <div className={`graph-files-viewer ${className}`} style={{
      padding: '20px',
      background: 'var(--bg-secondary, #f5f5f5)',
      borderRadius: '8px',
      border: '1px solid var(--border, #e0e0e0)',
    }}>
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>Graph Data Files</h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {fileInfo && (
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center', fontSize: '12px', color: 'var(--muted, #666)' }}>
                <span>{fileInfo.total_files} file{fileInfo.total_files !== 1 ? 's' : ''}</span>
                <span>{fileInfo.total_size_formatted}</span>
                {recentlyChangedCount > 0 && (
                  <span style={{ 
                    color: 'var(--accent, #1976d2)', 
                    fontWeight: '500',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    <span style={{ 
                      width: '8px', 
                      height: '8px', 
                      borderRadius: '50%', 
                      background: 'var(--accent, #1976d2)',
                      display: 'inline-block'
                    }}></span>
                    {recentlyChangedCount} recently changed
                  </span>
                )}
              </div>
            )}
            <button
              onClick={handleExport}
              disabled={exporting}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                background: exporting ? 'var(--muted, #999)' : 'var(--accent, #1976d2)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: exporting ? 'not-allowed' : 'pointer',
                fontWeight: '500',
              }}
            >
              {exporting ? 'Exporting...' : 'Export Now'}
            </button>
          </div>
        </div>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted, #666)', lineHeight: '1.5' }}>
          Physical CSV files that make up your knowledge graph data. These files are automatically exported when the graph is modified.
        </p>
        {fileInfo?.graph_dir && (
          <p style={{ margin: '8px 0 0 0', fontSize: '11px', color: 'var(--muted, #999)', fontFamily: 'monospace' }}>
            {fileInfo.graph_dir}
          </p>
        )}
      </div>

      {files.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted, #666)' }}>
          No CSV files found in graph directory
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {files.map((file) => {
            const isExpanded = expandedPreviews.has(file.name);
            const preview = previewData.get(file.name);
            const isLoadingPreview = loadingPreviews.has(file.name);

            return (
              <div
                key={file.name}
                style={{
                  padding: '12px 16px',
                  background: 'white',
                  borderRadius: '6px',
                  border: `1px solid ${file.recently_changed ? 'var(--accent, #1976d2)' : 'var(--border, #e0e0e0)'}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: '600', fontSize: '14px', color: 'var(--text, #333)' }}>
                        {file.name}
                      </span>
                      <span style={{
                        fontSize: '11px',
                        padding: '2px 6px',
                        background: 'var(--bg-secondary, #f5f5f5)',
                        borderRadius: '3px',
                        color: 'var(--muted, #666)',
                        textTransform: 'uppercase',
                      }}>
                        {file.type}
                      </span>
                      {file.graph_id && (
                        <span style={{
                          fontSize: '11px',
                          padding: '2px 6px',
                          background: 'var(--accent-light, #e3f2fd)',
                          borderRadius: '3px',
                          color: 'var(--accent, #1976d2)',
                          fontWeight: '500',
                        }}>
                          {file.graph_name || `Graph: ${file.graph_id}`}
                        </span>
                      )}
                      {file.recently_changed && (
                        <span style={{
                          fontSize: '11px',
                          padding: '2px 6px',
                          background: 'var(--accent-light, #e3f2fd)',
                          borderRadius: '3px',
                          color: 'var(--accent, #1976d2)',
                          fontWeight: '500',
                        }}>
                          ✨ Recently Changed
                        </span>
                      )}
                    </div>
                    <p style={{
                      margin: 0,
                      fontSize: '12px',
                      color: 'var(--muted, #666)',
                      lineHeight: '1.4',
                    }}>
                      {file.description}
                    </p>
                    <div style={{
                      marginTop: '8px',
                      display: 'flex',
                      gap: '12px',
                      fontSize: '11px',
                      color: 'var(--muted, #999)',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}>
                      <span>{file.size_formatted}</span>
                      <span>•</span>
                      <span>Modified: {file.modified_formatted}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      onClick={() => handleDownload(file.name)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        background: 'var(--bg-secondary, #f5f5f5)',
                        color: 'var(--text, #333)',
                        border: '1px solid var(--border, #e0e0e0)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                      title="Download file"
                    >
                      ⬇ Download
                    </button>
                    <button
                      onClick={() => togglePreview(file.name)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        background: isExpanded ? 'var(--accent, #1976d2)' : 'var(--bg-secondary, #f5f5f5)',
                        color: isExpanded ? 'white' : 'var(--text, #333)',
                        border: '1px solid var(--border, #e0e0e0)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                      title="Preview file contents"
                    >
                      {isExpanded ? '▼' : '▶'} Preview
                    </button>
                  </div>
                </div>

                {/* Preview Section */}
                {isExpanded && (
                  <div style={{
                    marginTop: '8px',
                    padding: '12px',
                    background: 'var(--bg-secondary, #f5f5f5)',
                    borderRadius: '4px',
                    border: '1px solid var(--border, #e0e0e0)',
                  }}>
                    {isLoadingPreview ? (
                      <div style={{ textAlign: 'center', color: 'var(--muted, #666)', fontSize: '12px' }}>
                        Loading preview...
                      </div>
                    ) : preview ? (
                      <div>
                        <div style={{ marginBottom: '8px', fontSize: '11px', color: 'var(--muted, #666)' }}>
                          Showing {preview.previewed_lines} of {preview.total_lines} lines
                        </div>
                        <div style={{
                          fontFamily: 'monospace',
                          fontSize: '11px',
                          overflowX: 'auto',
                          maxHeight: '300px',
                          overflowY: 'auto',
                        }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            {preview.headers && (
                              <thead>
                                <tr style={{ background: 'var(--bg-secondary, #f5f5f5)', fontWeight: '600' }}>
                                  {preview.headers.map((header, idx) => (
                                    <th key={idx} style={{ padding: '4px 8px', textAlign: 'left', border: '1px solid var(--border, #e0e0e0)' }}>
                                      {header}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                            )}
                            <tbody>
                              {preview.preview_lines.map((row, rowIdx) => (
                                <tr key={rowIdx}>
                                  {row.map((cell, cellIdx) => (
                                    <td key={cellIdx} style={{ padding: '4px 8px', border: '1px solid var(--border, #e0e0e0)', whiteSpace: 'nowrap' }}>
                                      {cell || <span style={{ color: 'var(--muted, #999)' }}>—</span>}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', color: 'var(--muted, #666)', fontSize: '12px' }}>
                        Failed to load preview
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
