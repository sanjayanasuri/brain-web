'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getConcept, getResourcesForConcept, type Resource, type Concept } from '../api-client';
import { setLastSession, trackResourceOpened, trackEvent } from '../lib/sessionState';
import { logEvent } from '../lib/eventsClient';
import TopBar from '../components/topbar/TopBar';

export default function ReaderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const conceptId = searchParams?.get('concept_id') || null;
  const resourceId = searchParams?.get('resource_id') || null;
  const from = searchParams?.get('from') || null; // 'evidence' | 'chat' | etc.
  const graphId = searchParams?.get('graph_id') || null;

  const [concept, setConcept] = useState<Concept | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Load concept and resources
  useEffect(() => {
    const loadData = async () => {
      if (!conceptId) {
        setError('Missing concept_id parameter');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Load concept
        const conceptData = await getConcept(conceptId);
        setConcept(conceptData);

        // Load resources for concept
        const resourcesData = await getResourcesForConcept(conceptId);
        setResources(resourcesData);

        // Select the specified resource, or default to newest
        if (resourceId) {
          const found = resourcesData.find(r => r.resource_id === resourceId);
          if (found) {
            setSelectedResource(found);
          } else if (resourcesData.length > 0) {
            // Fallback to newest if specified resource not found
            setSelectedResource(resourcesData[0]);
          }
        } else if (resourcesData.length > 0) {
          // Default to newest (first in list, or sort by created_at)
          const sorted = [...resourcesData].sort((a, b) => {
            const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
            const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
            return bTime - aTime;
          });
          setSelectedResource(sorted[0]);
        }

        // Update session state
        setLastSession({
          concept_id: conceptId,
          concept_name: conceptData.name,
          graph_id: graphId || undefined,
        });

        // Track resource opened event (use the selected resource after it's determined)
        const finalResourceId = resourceId || (resourcesData.length > 0 ? resourcesData[0].resource_id : null);
        if (finalResourceId) {
          trackResourceOpened(conceptId, conceptData.name, finalResourceId);
        }
      } catch (err) {
        console.error('Failed to load reader data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load resource');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [conceptId, resourceId, graphId, from]);

  // Update selected resource when resourceId param changes
  useEffect(() => {
    if (resourceId && resources.length > 0) {
      const found = resources.find(r => r.resource_id === resourceId);
      if (found) {
        setSelectedResource(found);
        // Log resource opened event
        logEvent({
          type: 'RESOURCE_OPENED',
          resource_id: found.resource_id,
          concept_id: conceptId || undefined,
          graph_id: graphId || undefined,
          payload: { resource_title: found.title },
        });
      }
    }
  }, [resourceId, resources, conceptId, graphId]);

  const handleResourceSelect = (resource: Resource) => {
    setSelectedResource(resource);
    // Update URL without navigation (shallow routing)
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('resource_id', resource.resource_id);
    router.replace(`/reader?${params.toString()}`, { scroll: false });
    
    trackEvent('switched_evidence', {
      concept_id: conceptId,
      resource_id: resource.resource_id,
    });
  };

  const handleBackToExplorer = () => {
    const params = new URLSearchParams();
    if (conceptId) {
      params.set('select', conceptId);
    }
    if (graphId) {
      params.set('graph_id', graphId);
    }
    router.push(`/?${params.toString()}`);
  };

  const handleOpenExternal = () => {
    if (selectedResource?.url) {
      window.open(selectedResource.url, '_blank', 'noopener,noreferrer');
    }
  };

  const getResourceIndex = (): { current: number; total: number } => {
    if (!selectedResource || resources.length === 0) {
      return { current: 0, total: 0 };
    }
    const index = resources.findIndex(r => r.resource_id === selectedResource.resource_id);
    return { current: index + 1, total: resources.length };
  };

  const handlePrevious = () => {
    if (!selectedResource || resources.length === 0) return;
    const currentIndex = resources.findIndex(r => r.resource_id === selectedResource.resource_id);
    if (currentIndex > 0) {
      handleResourceSelect(resources[currentIndex - 1]);
    }
  };

  const handleNext = () => {
    if (!selectedResource || resources.length === 0) return;
    const currentIndex = resources.findIndex(r => r.resource_id === selectedResource.resource_id);
    if (currentIndex < resources.length - 1) {
      handleResourceSelect(resources[currentIndex + 1]);
    }
  };

  const { current: currentIndex, total: totalCount } = getResourceIndex();
  const canGoPrevious = currentIndex > 1;
  const canGoNext = currentIndex < totalCount;

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--ink)' }}>
        <TopBar />
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          minHeight: 'calc(100vh - 60px)',
          padding: '40px',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '8px' }}>Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !concept) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--ink)' }}>
        <TopBar />
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          minHeight: 'calc(100vh - 60px)',
          padding: '40px',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '16px', color: 'var(--error)', marginBottom: '12px' }}>
              {error || 'Concept not found'}
            </div>
            <button
              onClick={handleBackToExplorer}
              style={{
                padding: '8px 16px',
                fontSize: '14px',
                background: 'var(--accent)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Back to Explorer
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--ink)' }}>
      <TopBar />
      <div style={{ 
        display: 'flex', 
        flexDirection: isMobile ? 'column' : 'row',
        height: isMobile ? 'auto' : 'calc(100vh - 60px)',
        overflow: 'hidden',
      }}>
        {/* Left: Reader Pane (60-70%) */}
        <div style={{ 
          flex: isMobile ? '0 0 auto' : '1 1 65%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRight: isMobile ? 'none' : '1px solid var(--border)',
          borderBottom: isMobile ? '1px solid var(--border)' : 'none',
          minHeight: isMobile ? '50vh' : 'auto',
        }}>
          {/* Reader Header */}
          <div style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--background)',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <button
                onClick={handleBackToExplorer}
                style={{
                  padding: '6px 12px',
                  fontSize: '13px',
                  background: 'transparent',
                  color: 'var(--accent)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                ← Back to Explorer
              </button>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {canGoPrevious && (
                  <button
                    onClick={handlePrevious}
                    style={{
                      padding: '6px 12px',
                      fontSize: '13px',
                      background: 'transparent',
                      color: 'var(--ink)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    ← Previous
                  </button>
                )}
                {totalCount > 0 && (
                  <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
                    {currentIndex} / {totalCount}
                  </span>
                )}
                {canGoNext && (
                  <button
                    onClick={handleNext}
                    style={{
                      padding: '6px 12px',
                      fontSize: '13px',
                      background: 'transparent',
                      color: 'var(--ink)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    Next →
                  </button>
                )}
              </div>
            </div>
            
            {selectedResource && (
              <>
                <h1 style={{ 
                  fontSize: '20px', 
                  fontWeight: '600', 
                  marginBottom: '12px',
                  color: 'var(--ink)',
                }}>
                  {selectedResource.title || 'Untitled Resource'}
                </h1>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px' }}>
                  {selectedResource.source && (
                    <span className="badge badge--soft" style={{ fontSize: '11px' }}>
                      {selectedResource.source}
                    </span>
                  )}
                  {selectedResource.kind && (
                    <span className="badge badge--soft" style={{ fontSize: '11px' }}>
                      {selectedResource.kind}
                    </span>
                  )}
                  {selectedResource.created_at && (
                    <span className="badge badge--soft" style={{ fontSize: '11px' }}>
                      {new Date(selectedResource.created_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {selectedResource.url && (
                    <button
                      onClick={handleOpenExternal}
                      style={{
                        padding: '6px 12px',
                        fontSize: '13px',
                        background: 'var(--accent)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                      }}
                    >
                      Open External
                    </button>
                  )}
                  {selectedResource.url && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(selectedResource.url!);
                      }}
                      style={{
                        padding: '6px 12px',
                        fontSize: '13px',
                        background: 'transparent',
                        color: 'var(--ink)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                      }}
                    >
                      Copy Link
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Reader Content */}
          <div style={{ 
            flex: '1 1 auto',
            overflow: 'auto',
            padding: '24px',
          }}>
            {selectedResource ? (
              <ResourceContent resource={selectedResource} />
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
                <p>No resource selected</p>
                {resources.length === 0 && (
                  <p style={{ fontSize: '14px', marginTop: '8px' }}>
                    No evidence available for this concept.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Context Rail (30-40%) */}
        <div style={{ 
          flex: isMobile ? '0 0 auto' : '0 0 35%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--background)',
          borderLeft: isMobile ? 'none' : '1px solid var(--border)',
          maxHeight: isMobile ? '50vh' : 'auto',
        }}>
          <ContextRail
            concept={concept}
            resources={resources}
            selectedResourceId={selectedResource?.resource_id || null}
            onResourceSelect={handleResourceSelect}
            graphId={graphId || undefined}
          />
        </div>
      </div>
    </div>
  );
}

function formatReaderMetricNumber(value: any, decimals = 2): string | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  });
}

function compactReaderMetricNumber(value: any): string | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const absNum = Math.abs(num);
  if (absNum >= 1_000_000_000_000) return `${(num / 1_000_000_000_000).toFixed(2)}T`;
  if (absNum >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (absNum >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (absNum >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toFixed(2);
}

function formatReaderPercent(value: any): string | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return `${num > 0 ? '+' : ''}${num.toFixed(2)}%`;
}

function formatReaderDelta(value: any): string | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return `${num > 0 ? '+' : ''}${num.toFixed(2)}`;
}

function readerStructuredMetric(resource: Resource): Record<string, any> | null {
  const meta = resource.metadata;
  if (!meta || typeof meta !== 'object') return null;
  const direct = (meta.metric || meta.quote || meta.structured_data) as Record<string, any> | undefined;
  if (direct && typeof direct === 'object') return direct;
  const sourceResult = (meta.source_result || {}) as Record<string, any>;
  const nested = sourceResult.structured_data;
  return nested && typeof nested === 'object' ? (nested as Record<string, any>) : null;
}

function readerStructuredHeadlines(resource: Resource): Array<Record<string, any>> {
  const meta = resource.metadata;
  if (!meta || typeof meta !== 'object') return [];
  return Array.isArray((meta as any).headlines)
    ? ((meta as any).headlines as Array<Record<string, any>>).filter((h) => h && typeof h === 'object')
    : [];
}

function readerStructuredKind(resource: Resource): 'metric' | 'news' | null {
  const meta = resource.metadata;
  if (resource.kind === 'metric_snapshot') return 'metric';
  if (meta && typeof meta === 'object') {
    if ((meta as any).type === 'live_metric_snapshot' || (meta as any).check_kind === 'live_metric') return 'metric';
    if ((meta as any).check_kind === 'exa_news' || resource.source === 'exa_news' || Array.isArray((meta as any).headlines)) return 'news';
  }
  return null;
}

function readerHost(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function ReaderMetricResourceView({ resource }: { resource: Resource }) {
  const meta = (resource.metadata && typeof resource.metadata === 'object') ? (resource.metadata as Record<string, any>) : {};
  const metric = readerStructuredMetric(resource) || {};
  const kind = String(metric.kind || meta.metric_kind || '').toLowerCase();
  const asOf = metric.as_of || metric.observation_date || meta.refreshed_at || resource.created_at;
  const provider = String(metric.provider || meta.provider || resource.source || 'market_data');

  const pillStyle: React.CSSProperties = {
    fontSize: '11px',
    padding: '4px 8px',
    borderRadius: '999px',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--ink)',
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
  };

  const renderPills = (items: Array<{ label: string; value: string | null | undefined }>) => (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
      {items.filter((it) => it.value).map((it) => (
        <span key={`${it.label}:${it.value}`} style={pillStyle}>
          <strong style={{ fontWeight: 600 }}>{it.label}</strong> {it.value}
        </span>
      ))}
    </div>
  );

  if (kind === 'stock_quote' || kind === 'crypto_quote') {
    const price = formatReaderMetricNumber(metric.price, 2);
    const change = formatReaderDelta(metric.change);
    const pct = formatReaderPercent(metric.change_percent);
    const isUp = Number(metric.change_percent) >= 0;
    return (
      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '20px' }}>
        <div style={{ border: '1px solid rgba(59,130,246,0.14)', borderRadius: '12px', background: 'linear-gradient(180deg, rgba(59,130,246,0.06), rgba(59,130,246,0.01))', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {kind === 'crypto_quote' ? 'Crypto Snapshot' : 'Market Quote Snapshot'}
              </div>
              <div style={{ marginTop: '6px', fontSize: '28px', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1 }}>
                {metric.symbol || meta.symbol || 'Ticker'}
              </div>
              {metric.name && (
                <div style={{ marginTop: '4px', fontSize: '14px', color: 'var(--muted)' }}>{metric.name}</div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--ink)' }}>
                {price || 'N/A'} {metric.currency || ''}
              </div>
              {(change || pct) && (
                <div style={{ marginTop: '6px', fontSize: '14px', fontWeight: 600, color: isUp ? '#15803d' : '#b91c1c' }}>
                  {[change, pct].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          </div>
          {renderPills([
            { label: 'Provider', value: provider },
            { label: 'As of', value: asOf ? new Date(asOf).toLocaleString() : null },
            { label: 'Exchange', value: metric.exchange ? String(metric.exchange) : null },
            { label: 'State', value: metric.market_state ? String(metric.market_state) : null },
            { label: 'Market Cap', value: compactReaderMetricNumber(metric.market_cap) },
            { label: 'Volume', value: compactReaderMetricNumber(metric.volume) },
          ])}
          {(metric.source_delay_note || resource.caption) && (
            <div style={{ marginTop: '14px', fontSize: '13px', color: 'var(--muted)', lineHeight: 1.55 }}>
              {resource.caption}
              {metric.source_delay_note ? <div style={{ marginTop: '8px' }}>{metric.source_delay_note}</div> : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (kind === 'fx_rate' || kind === 'macro_indicator') {
    return (
      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '20px' }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: '12px', background: 'var(--surface)', padding: '20px' }}>
          <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase' }}>
            {kind === 'fx_rate' ? 'FX Snapshot' : 'Macro Indicator Snapshot'}
          </div>
          <div style={{ marginTop: '6px', fontSize: '22px', fontWeight: 700, color: 'var(--ink)' }}>
            {resource.title || metric.title || 'Metric'}
          </div>
          <div style={{ marginTop: '8px', fontSize: '18px', color: 'var(--ink)' }}>
            {kind === 'fx_rate'
              ? `${metric.base || ''}/${metric.quote || ''} ${formatReaderMetricNumber(metric.rate, 6) || ''}`
              : `${formatReaderMetricNumber(metric.value, 4) || String(metric.value ?? 'N/A')}${metric.unit ? ` ${metric.unit}` : ''}`}
          </div>
          {renderPills([
            { label: 'Provider', value: provider },
            { label: 'As of', value: asOf ? new Date(asOf).toLocaleString() : null },
            { label: 'Series', value: metric.series_id ? String(metric.series_id) : null },
            { label: 'Observation', value: metric.observation_date ? String(metric.observation_date) : null },
          ])}
          {resource.caption && (
            <div style={{ marginTop: '14px', fontSize: '13px', color: 'var(--muted)', lineHeight: 1.55 }}>
              {resource.caption}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '860px', margin: '0 auto', padding: '20px' }}>
      <div style={{ border: '1px solid var(--border)', borderRadius: '12px', background: 'var(--surface)', padding: '20px' }}>
        <h3 style={{ margin: 0, fontSize: '18px' }}>{resource.title || 'Live metric snapshot'}</h3>
        {resource.caption && <p style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--muted)' }}>{resource.caption}</p>}
      </div>
    </div>
  );
}

function ReaderNewsResourceView({ resource }: { resource: Resource }) {
  const headlines = readerStructuredHeadlines(resource);
  return (
    <div style={{ maxWidth: '920px', margin: '0 auto', padding: '20px' }}>
      <div style={{ border: '1px solid rgba(245,158,11,0.16)', borderRadius: '12px', background: 'linear-gradient(180deg, rgba(245,158,11,0.04), rgba(245,158,11,0.01))', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>News Feed Snapshot</div>
            <div style={{ marginTop: '6px', fontSize: '20px', fontWeight: 700, color: 'var(--ink)' }}>
              {resource.title || 'News headlines'}
            </div>
          </div>
          <span style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '999px', border: '1px solid rgba(245,158,11,0.18)', background: 'rgba(245,158,11,0.08)', color: '#b45309' }}>
            {headlines.length} headline{headlines.length === 1 ? '' : 's'}
          </span>
        </div>

        {resource.caption && (
          <div style={{ marginTop: '10px', fontSize: '13px', color: 'var(--muted)', lineHeight: 1.55 }}>
            {resource.caption}
          </div>
        )}

        <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {headlines.length > 0 ? headlines.map((headline, index) => {
            const title = typeof headline.title === 'string' ? headline.title : `Headline ${index + 1}`;
            const url = typeof headline.url === 'string' ? headline.url : undefined;
            const snippet = typeof headline.snippet === 'string' ? headline.snippet : '';
            const metadata = headline.metadata && typeof headline.metadata === 'object' ? headline.metadata as Record<string, any> : {};
            const published = metadata.publishedDate || metadata.published_date || metadata.date || metadata.publishedAt;
            return (
              <div key={`${title}-${index}`} style={{ border: '1px solid var(--border)', borderRadius: '10px', background: 'var(--surface)', padding: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
                  {url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'var(--ink)', fontWeight: 600, lineHeight: 1.35 }}>
                      {title}
                    </a>
                  ) : (
                    <div style={{ color: 'var(--ink)', fontWeight: 600, lineHeight: 1.35 }}>{title}</div>
                  )}
                  <div style={{ fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {readerHost(url) || 'web'}
                  </div>
                </div>
                {(published || snippet) && (
                  <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--muted)', lineHeight: 1.45 }}>
                    {published ? `${new Date(String(published)).toLocaleString()}${snippet ? ' · ' : ''}` : null}
                    {snippet || null}
                  </div>
                )}
              </div>
            );
          }) : (
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
              No headline metadata found for this resource.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Resource Content Renderer
function ResourceContent({ resource }: { resource: Resource }) {
  const structuredKind = readerStructuredKind(resource);
  if (structuredKind === 'metric') {
    return <ReaderMetricResourceView resource={resource} />;
  }
  if (structuredKind === 'news') {
    return <ReaderNewsResourceView resource={resource} />;
  }

  const isWebLink = resource.kind === 'web_link' || resource.url?.startsWith('http');
  const isPDF = resource.kind === 'pdf' || resource.mime_type === 'application/pdf';
  const isText = resource.kind === 'file' && resource.mime_type?.startsWith('text/');
  const hasMetadataText = resource.metadata?.text || resource.metadata?.body;

  // Web URL resources
  if (isWebLink && resource.url && !resource.url.startsWith('browseruse://')) {
    // Check if same-origin or allowlisted (for now, show external link button)
    const urlObj = new URL(resource.url, window.location.origin);
    const isSameOrigin = urlObj.origin === window.location.origin;
    
    if (isSameOrigin) {
      return (
        <div style={{ width: '100%', height: '100%' }}>
          <iframe
            src={resource.url}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              borderRadius: '8px',
            }}
            title={resource.title || 'Resource preview'}
          />
        </div>
      );
    } else {
      return (
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>Preview not available</h3>
            <p style={{ fontSize: '14px', color: 'var(--muted)' }}>
              This is an external URL that cannot be embedded for security reasons.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <a
              href={resource.url}
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
              }}
            >
              Open External
            </a>
          </div>
          {resource.caption && (
            <div style={{ marginTop: '24px', padding: '16px', background: 'var(--surface)', borderRadius: '8px', textAlign: 'left' }}>
              <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>Summary</h4>
              <p style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--ink)' }}>{resource.caption}</p>
            </div>
          )}
        </div>
      );
    }
  }

  // PDF resources
  if (isPDF && resource.url) {
    // Check if it's a local/static resource
    const isLocal = resource.url.startsWith('/static/') || resource.url.startsWith('/uploaded_resources/');
    
    if (isLocal) {
      const fullUrl = resource.url.startsWith('http') ? resource.url : `${process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'}${resource.url}`;
      return (
        <div style={{ width: '100%', height: '100%' }}>
          <object
            data={fullUrl}
            type="application/pdf"
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              borderRadius: '8px',
            }}
          >
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <p style={{ marginBottom: '16px' }}>PDF preview not available in your browser.</p>
              <a
                href={fullUrl}
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
                }}
              >
                Open PDF
              </a>
            </div>
          </object>
        </div>
      );
    } else {
      return (
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>PDF Preview</h3>
            <p style={{ fontSize: '14px', color: 'var(--muted)' }}>
              This PDF is hosted externally.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <a
              href={resource.url}
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
              }}
            >
              Open PDF
            </a>
          </div>
          {resource.caption && (
            <div style={{ marginTop: '24px', padding: '16px', background: 'var(--surface)', borderRadius: '8px', textAlign: 'left' }}>
              <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>Summary</h4>
              <p style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--ink)' }}>{resource.caption}</p>
            </div>
          )}
        </div>
      );
    }
  }

  // Text/markdown resources
  if (isText || hasMetadataText) {
    const textContent = hasMetadataText 
      ? (typeof resource.metadata?.text === 'string' ? resource.metadata.text : resource.metadata?.body)
      : resource.caption;
    
    if (textContent) {
      return (
        <div style={{ 
          maxWidth: '800px', 
          margin: '0 auto',
          lineHeight: '1.7',
          fontSize: '15px',
        }}>
          <pre style={{
            whiteSpace: 'pre-wrap',
            wordWrap: 'break-word',
            fontFamily: 'inherit',
            background: 'transparent',
            padding: 0,
            margin: 0,
            color: 'var(--ink)',
          }}>
            {textContent}
          </pre>
        </div>
      );
    }
  }

  // Fallback: show metadata and caption
  return (
    <div style={{ padding: '40px', textAlign: 'center' }}>
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>Preview not available</h3>
        <p style={{ fontSize: '14px', color: 'var(--muted)' }}>
          This resource type cannot be displayed inline.
        </p>
      </div>
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
        {resource.url && (
          <a
            href={resource.url}
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
            }}
          >
            {resource.url.startsWith('http') ? 'Open External' : 'Download'}
          </a>
        )}
        {hasMetadataText && (
          <button
            onClick={() => {
              // Could open a modal with extracted text
              alert('Extracted text view - to be implemented');
            }}
            style={{
              padding: '10px 20px',
              fontSize: '14px',
              background: 'transparent',
              color: 'var(--accent)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            View Extracted Text
          </button>
        )}
      </div>
      {resource.caption && (
        <div style={{ marginTop: '24px', padding: '16px', background: 'var(--surface)', borderRadius: '8px', textAlign: 'left', maxWidth: '600px', margin: '24px auto 0' }}>
          <h4 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>Summary</h4>
          <p style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--ink)' }}>{resource.caption}</p>
        </div>
      )}
    </div>
  );
}

// Context Rail Component
function ContextRail({
  concept,
  resources,
  selectedResourceId,
  onResourceSelect,
  graphId,
}: {
  concept: Concept;
  resources: Resource[];
  selectedResourceId: string | null;
  onResourceSelect: (resource: Resource) => void;
  graphId?: string;
}) {
  const router = useRouter();

  const formatFreshness = (createdAt: string | null | undefined): string => {
    if (!createdAt) return 'Unknown';
    const date = new Date(createdAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return date.toLocaleDateString();
  };

  return (
    <div style={{ 
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Concept Header */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <h2 style={{ 
          fontSize: '16px', 
          fontWeight: '600', 
          marginBottom: '8px',
          color: 'var(--ink)',
        }}>
          {concept.name}
        </h2>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {concept.domain && (
            <span className="badge badge--soft" style={{ fontSize: '11px' }}>
              {concept.domain}
            </span>
          )}
          {concept.type && (
            <span className="badge badge--soft" style={{ fontSize: '11px' }}>
              {concept.type}
            </span>
          )}
        </div>
      </div>

      {/* Evidence List */}
      <div style={{
        flex: '1 1 auto',
        overflow: 'auto',
        padding: '12px',
      }}>
        <h3 style={{ 
          fontSize: '13px', 
          fontWeight: '600', 
          marginBottom: '12px',
          color: 'var(--muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Evidence ({resources.length})
        </h3>
        {resources.length === 0 ? (
          <div style={{ 
            padding: '20px', 
            textAlign: 'center', 
            color: 'var(--muted)',
            fontSize: '13px',
          }}>
            No evidence available
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {resources.map((resource) => {
              const isSelected = resource.resource_id === selectedResourceId;
              return (
                <div
                  key={resource.resource_id}
                  onClick={() => onResourceSelect(resource)}
                  style={{
                    padding: '12px',
                    borderRadius: '6px',
                    border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                    background: isSelected ? 'rgba(var(--accent-rgb), 0.1)' : 'var(--background)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'var(--surface)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'var(--background)';
                    }
                  }}
                >
                  <div style={{ 
                    fontSize: '13px', 
                    fontWeight: isSelected ? '600' : '500',
                    marginBottom: '6px',
                    color: 'var(--ink)',
                  }}>
                    {resource.title || 'Untitled Resource'}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {resource.source && (
                      <span className="badge badge--soft" style={{ fontSize: '10px' }}>
                        {resource.source}
                      </span>
                    )}
                    {resource.created_at && (
                      <span className="badge badge--soft" style={{ fontSize: '10px' }}>
                        {formatFreshness(resource.created_at)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Chat Dock (Collapsed by default, but visible) */}
      <div style={{
        padding: '12px',
        borderTop: '1px solid var(--border)',
        flexShrink: 0,
        background: 'var(--surface)',
      }}>
        <button
          onClick={() => {
            const params = new URLSearchParams();
            if (concept.node_id) {
              params.set('select', concept.node_id);
            }
            if (graphId) {
              params.set('graph_id', graphId);
            }
            router.push(`/?${params.toString()}`);
          }}
          style={{
            width: '100%',
            padding: '10px',
            fontSize: '13px',
            background: 'var(--accent)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Open Chat
        </button>
      </div>
    </div>
  );
}
