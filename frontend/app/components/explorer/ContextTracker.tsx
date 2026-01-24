'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  getSemanticPathString, 
  getRecentPath,
  addConceptToHistory,
  type ConceptNavigationEntry 
} from '../../lib/conceptNavigationHistory';

interface ContextInfo {
  domPath: string;
  position: { top: number; left: number; width: number; height: number };
  reactComponent: string;
  htmlElement: string;
  timestamp: number;
  semanticInfo?: {
    text?: string;
    label?: string;
    title?: string;
    placeholder?: string;
    value?: string;
    description?: string;
  };
}

export default function ContextTracker() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [contextHistory, setContextHistory] = useState<ContextInfo[]>([]);
  const [currentContext, setCurrentContext] = useState<ContextInfo | null>(null);
  const currentContextRef = useRef<ContextInfo | null>(null);

  useEffect(() => {
    const handleElementHover = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target) return;

      // Get DOM path
      const getDomPath = (element: HTMLElement): string => {
        const path: string[] = [];
        let current: HTMLElement | null = element;
        
        while (current && current !== document.body) {
          const parent: HTMLElement | null = current.parentElement;
          if (!parent) break;
          
          const siblings = Array.from(parent.children);
          const index = siblings.indexOf(current);
          const tagName = current.tagName.toLowerCase();
          
          // Try to find a unique identifier
          const id = current.id ? `#${current.id}` : '';
          const className = current.className && typeof current.className === 'string' 
            ? `.${current.className.split(' ').join('.')}` 
            : '';
          
          if (id) {
            path.unshift(`${tagName}${id}`);
          } else if (className) {
            path.unshift(`${tagName}${className}`);
          } else {
            path.unshift(`${tagName}[${index}]`);
          }
          
          current = parent;
        }
        
        return path.join(' > ');
      };

      // Get React component name
      const getReactComponent = (element: HTMLElement): string => {
        // Try to find React fiber
        const fiberKey = Object.keys(element).find(key => 
          key.startsWith('__reactFiber') || key.startsWith('__reactInternalInstance')
        );
        
        if (fiberKey) {
          const fiber = (element as any)[fiberKey];
          if (fiber) {
            let current = fiber;
            while (current) {
              if (current.type && typeof current.type === 'function') {
                return current.type.displayName || current.type.name || 'Unknown';
              }
              if (current.type && typeof current.type === 'object' && current.type.displayName) {
                return current.type.displayName;
              }
              current = current.return;
            }
          }
        }
        return 'Unknown';
      };

      // Get position
      const rect = target.getBoundingClientRect();
      const position = {
        top: Math.round(rect.top + window.scrollY),
        left: Math.round(rect.left + window.scrollX),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };

      // Get HTML element string (truncated)
      const htmlString = target.outerHTML.length > 100 
        ? target.outerHTML.substring(0, 100) + '...'
        : target.outerHTML;

      // Extract semantic information
      const getSemanticInfo = (element: HTMLElement) => {
        const info: ContextInfo['semanticInfo'] = {};
        
        // Get text content (first 100 chars)
        const text = element.textContent?.trim();
        if (text && text.length > 0) {
          info.text = text.length > 100 ? text.substring(0, 100) + '...' : text;
        }
        
        // Get label (aria-label, title, or label element)
        info.label = element.getAttribute('aria-label') || 
                    element.getAttribute('title') ||
                    (element.tagName === 'LABEL' ? text : null) ||
                    undefined;
        
        // Get title attribute
        if (element.getAttribute('title')) {
          info.title = element.getAttribute('title')!;
        }
        
        // Get placeholder (for inputs)
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          info.placeholder = element.placeholder;
          info.value = element.value;
        }
        
        // Get description from nearby elements
        const id = element.id;
        if (id) {
          const descElement = document.querySelector(`[aria-describedby*="${id}"]`) || 
                            document.querySelector(`#${id}-description`);
          if (descElement) {
            info.description = descElement.textContent?.trim()?.substring(0, 100);
          }
        }
        
        return Object.keys(info).length > 0 ? info : undefined;
      };

      const contextInfo: ContextInfo = {
        domPath: getDomPath(target),
        position,
        reactComponent: getReactComponent(target),
        htmlElement: htmlString,
        timestamp: Date.now(),
        semanticInfo: getSemanticInfo(target),
      };

      currentContextRef.current = contextInfo;
      setCurrentContext(contextInfo);
    };

    // Throttle updates
    let timeoutId: NodeJS.Timeout | null = null;
    const throttledHandler = (event: MouseEvent) => {
      if (timeoutId) return;
      timeoutId = setTimeout(() => {
        handleElementHover(event);
        timeoutId = null;
      }, 100);
    };

    document.addEventListener('mousemove', throttledHandler);
    return () => {
      document.removeEventListener('mousemove', throttledHandler);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  // Update history when context changes
  useEffect(() => {
    if (currentContext) {
      setContextHistory(prev => {
        const last = prev[prev.length - 1];
        // Only add if it's different from the last one
        if (!last || 
            last.domPath !== currentContext.domPath ||
            last.reactComponent !== currentContext.reactComponent) {
          return [...prev.slice(-9), currentContext].slice(-10); // Keep last 10
        }
        return prev;
      });
    }
  }, [currentContext?.domPath, currentContext?.reactComponent]);

  // Store context in a global store for backend access
  useEffect(() => {
    if (typeof window !== 'undefined' && currentContext) {
      (window as any).__brainWebContext = currentContext;
    }
  }, [currentContext?.domPath]);

  const displayContext = currentContext || (contextHistory.length > 0 ? contextHistory[contextHistory.length - 1] : null);

  // Always show the expanded panel when isExpanded is true
  if (!isExpanded) {
    return null;
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: 10000,
      pointerEvents: 'auto',
      display: 'block',
    }}>
      <div style={{
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '16px',
        minWidth: '300px',
        maxWidth: '500px',
        maxHeight: '400px',
        overflowY: 'auto',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
      }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>Context</h3>
            <button
              onClick={() => setIsExpanded(false)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '18px',
                padding: '0',
                width: '24px',
                height: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ×
            </button>
          </div>

          {displayContext && (
            <div style={{ marginBottom: '16px' }}>
              {/* Semantic information - human readable */}
              {displayContext.semanticInfo && (
                <div style={{ marginBottom: '12px', padding: '8px', background: 'var(--background)', borderRadius: '4px' }}>
                  {displayContext.semanticInfo.label && (
                    <div style={{ marginBottom: '4px' }}>
                      <strong style={{ fontSize: '13px' }}>{displayContext.semanticInfo.label}</strong>
                    </div>
                  )}
                  {displayContext.semanticInfo.text && !displayContext.semanticInfo.label && (
                    <div style={{ marginBottom: '4px' }}>
                      <strong style={{ fontSize: '13px' }}>Content:</strong> {displayContext.semanticInfo.text}
                    </div>
                  )}
                  {displayContext.semanticInfo.title && (
                    <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                      {displayContext.semanticInfo.title}
                    </div>
                  )}
                  {displayContext.semanticInfo.placeholder && (
                    <div style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic' }}>
                      Placeholder: {displayContext.semanticInfo.placeholder}
                    </div>
                  )}
                  {displayContext.semanticInfo.value && (
                    <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                      Value: {displayContext.semanticInfo.value}
                    </div>
                  )}
                </div>
              )}
              
              {/* Technical details - collapsible */}
              <details style={{ fontSize: '11px', color: 'var(--muted)' }}>
                <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>Technical Details</summary>
                <div style={{ marginTop: '8px' }}>
                  <div style={{ marginBottom: '6px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '2px' }}>Component:</div>
                    <div style={{ fontSize: '12px', fontFamily: 'monospace' }}>
                      {displayContext.reactComponent}
                    </div>
                  </div>
                  <div style={{ marginBottom: '6px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '2px' }}>DOM Path:</div>
                    <div style={{ fontSize: '11px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      {displayContext.domPath}
                    </div>
                  </div>
                  <div style={{ marginBottom: '6px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '2px' }}>Position:</div>
                    <div style={{ fontSize: '11px', fontFamily: 'monospace' }}>
                      {displayContext.position.width}×{displayContext.position.height}px at ({displayContext.position.left}, {displayContext.position.top})
                    </div>
                  </div>
                </div>
              </details>
            </div>
          )}

          {contextHistory.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '8px' }}>Path History:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '150px', overflowY: 'auto' }}>
                {contextHistory.slice().reverse().map((ctx, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '6px',
                      background: ctx.domPath === displayContext?.domPath ? 'var(--background)' : 'transparent',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontFamily: 'monospace',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      currentContextRef.current = ctx;
                      setCurrentContext(ctx);
                      setContextHistory(prev => {
                        const filtered = prev.filter(c => c.domPath !== ctx.domPath);
                        return [...filtered, ctx];
                      });
                    }}
                  >
                    <div style={{ fontWeight: '500' }}>
                      {ctx.semanticInfo?.label || ctx.semanticInfo?.text || ctx.reactComponent}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>
                      {ctx.reactComponent}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
      </div>
    </div>
  );
}

// Button component for toolbar
export function ContextTrackerButton() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentConceptId, setCurrentConceptId] = useState<string | null>(null);
  const [semanticPath, setSemanticPath] = useState<string>('');
  const [recentPath, setRecentPath] = useState<ConceptNavigationEntry[]>([]);

  // Listen to selectedNode changes from GraphContext
  useEffect(() => {
    const checkSelectedNode = () => {
      if (typeof window !== 'undefined') {
        // Try to get selectedNode from GraphContext via a global or event
        // For now, we'll use a polling approach to check for selectedNode
        const checkNode = () => {
          // Check if there's a way to get the current selected node
          // We'll use a custom event or check localStorage/global state
          if ((window as any).__brainWebSelectedNode) {
            const node = (window as any).__brainWebSelectedNode;
            if (node?.node_id !== currentConceptId) {
              setCurrentConceptId(node?.node_id || null);
              if (node?.node_id) {
                const path = getSemanticPathString(node.node_id, 5);
                setSemanticPath(path);
                setRecentPath(getRecentPath(5));
              }
            }
          }
        };
        
        checkNode();
        const interval = setInterval(checkNode, 500);
        return () => clearInterval(interval);
      }
    };
    
    return checkSelectedNode();
  }, [currentConceptId]);

  // Also listen for URL changes (when select param changes)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const updateFromURL = () => {
      const params = new URLSearchParams(window.location.search);
      const selectId = params.get('select');
      if (selectId && selectId !== currentConceptId) {
        setCurrentConceptId(selectId);
        const path = getSemanticPathString(selectId, 5);
        setSemanticPath(path);
        setRecentPath(getRecentPath(5));
      }
    };
    
    updateFromURL();
    const interval = setInterval(updateFromURL, 1000);
    return () => clearInterval(interval);
  }, [currentConceptId]);

  const displayPath = semanticPath || (recentPath.length > 0 ? recentPath.map(e => e.name).join(' → ') : 'No context');

  // Format path for button display - show last 2-3 segments
  const formatPathForButton = (path: string) => {
    if (!path) return null;
    const segments = path.split(' → ');
    if (segments.length <= 2) return path;
    // Show last 2 segments with ellipsis
    return `... → ${segments.slice(-2).join(' → ')}`;
  };

  const buttonPath = displayPath ? formatPathForButton(displayPath) : null;

  return (
    <>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          padding: '6px 10px',
          background: isExpanded ? 'var(--accent)' : 'transparent',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '11px',
          fontWeight: '500',
          color: isExpanded ? 'white' : 'var(--ink)',
          minWidth: '80px',
          maxWidth: '220px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          transition: 'all 0.2s ease',
        }}
        title={displayPath || "Show semantic context"}
      >
        {buttonPath ? (
          <>
            <span style={{ fontSize: '10px', opacity: 0.8 }}>📍</span>
            <span style={{ 
              fontSize: '11px', 
              overflow: 'hidden', 
              textOverflow: 'ellipsis',
              flex: 1,
            }}>
              {buttonPath}
            </span>
          </>
        ) : (
          <span>📍</span>
        )}
      </button>
      {isExpanded && (
        <div style={{
          position: 'fixed',
          bottom: '80px',
          right: '20px',
          zIndex: 10000,
          pointerEvents: 'auto',
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '16px',
          minWidth: '320px',
          maxWidth: '480px',
          maxHeight: '500px',
          overflowY: 'auto',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: 'var(--ink)' }}>Semantic Context</h3>
            <button
              onClick={() => setIsExpanded(false)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '18px',
                padding: '0',
                width: '24px',
                height: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--muted)',
              }}
              title="Close"
            >
              ×
            </button>
          </div>
          
          {semanticPath ? (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ 
                marginBottom: '12px', 
                padding: '14px', 
                background: 'var(--background)', 
                borderRadius: '8px',
                border: '1px solid var(--border)',
              }}>
                <div style={{ 
                  fontSize: '11px', 
                  fontWeight: '600', 
                  marginBottom: '10px',
                  color: 'var(--muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  Current Path
                </div>
                <div style={{ 
                  fontSize: '13px', 
                  color: 'var(--ink)',
                  lineHeight: '1.6',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '6px',
                  alignItems: 'center',
                }}>
                  {semanticPath.split(' → ').map((segment, idx, arr) => (
                    <React.Fragment key={idx}>
                      <span style={{
                        padding: '4px 8px',
                        background: idx === arr.length - 1 ? 'var(--accent)' : 'var(--surface)',
                        color: idx === arr.length - 1 ? 'white' : 'var(--ink)',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: idx === arr.length - 1 ? '600' : '400',
                        whiteSpace: 'nowrap',
                      }}>
                        {segment}
                      </span>
                      {idx < arr.length - 1 && (
                        <span style={{ color: 'var(--muted)', fontSize: '12px' }}>→</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
              
              {recentPath.length > 0 && (
                <details style={{ fontSize: '12px' }}>
                  <summary style={{ 
                    cursor: 'pointer', 
                    marginBottom: '8px',
                    color: 'var(--ink)',
                    fontWeight: '500',
                    padding: '4px 0',
                  }}>
                    Recent Navigation
                  </summary>
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {recentPath.slice().reverse().map((entry, idx) => (
                      <div
                        key={entry.node_id}
                        style={{
                          padding: '8px 10px',
                          background: idx === recentPath.length - 1 ? 'var(--accent)' : 'var(--surface)',
                          color: idx === recentPath.length - 1 ? 'white' : 'var(--ink)',
                          borderRadius: '6px',
                          fontSize: '12px',
                          border: idx === recentPath.length - 1 ? 'none' : '1px solid var(--border)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span style={{ fontWeight: idx === recentPath.length - 1 ? '600' : '400' }}>
                          {entry.name}
                        </span>
                        {entry.relationship && (
                          <span style={{ 
                            fontSize: '10px', 
                            opacity: 0.8, 
                            marginLeft: '8px',
                            padding: '2px 6px',
                            background: idx === recentPath.length - 1 ? 'rgba(255, 255, 255, 0.2)' : 'var(--background)',
                            borderRadius: '3px',
                          }}>
                            {entry.relationship}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ) : (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)' }}>
              <div style={{ fontSize: '13px', marginBottom: '8px', fontWeight: '500' }}>No semantic context yet</div>
              <div style={{ fontSize: '11px' }}>Navigate between concepts to build a path</div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
