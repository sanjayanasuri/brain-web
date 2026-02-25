'use client';

import type { CSSProperties } from 'react';
import type { Resource } from '@/app/api-client';

export type StructuredResourceKind = 'metric' | 'news';

function formatTimestampLabel(ts?: string | null): string {
  if (!ts) return 'Unknown';
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return 'Unknown';
    return d.toLocaleString();
  } catch {
    return 'Unknown';
  }
}

function compactMetricNumber(value: any): string | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const absNum = Math.abs(num);
  if (absNum >= 1_000_000_000_000) return `${(num / 1_000_000_000_000).toFixed(2)}T`;
  if (absNum >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(2)}B`;
  if (absNum >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (absNum >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toFixed(2);
}

function formatMetricValue(value: any, decimals = 2): string | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  });
}

function formatPercent(value: any): string | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return `${num > 0 ? '+' : ''}${num.toFixed(2)}%`;
}

function formatDelta(value: any): string | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return `${num > 0 ? '+' : ''}${num.toFixed(2)}`;
}

function getStructuredMetricPayload(resource: Resource): Record<string, any> | null {
  const meta = resource.metadata;
  if (!meta || typeof meta !== 'object') return null;
  const direct = (meta.metric || meta.quote || meta.structured_data) as Record<string, any> | undefined;
  if (direct && typeof direct === 'object') return direct;
  const sourceResult = (meta.source_result || {}) as Record<string, any>;
  const nested = sourceResult.structured_data;
  return nested && typeof nested === 'object' ? (nested as Record<string, any>) : null;
}

function getStructuredNewsHeadlines(resource: Resource): Array<Record<string, any>> {
  const meta = resource.metadata;
  if (!meta || typeof meta !== 'object') return [];
  const headlines = (meta as any).headlines;
  return Array.isArray(headlines) ? headlines.filter((item) => item && typeof item === 'object') : [];
}

function getHostnameLabel(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function getStructuredResourceKind(resource: Resource): StructuredResourceKind | null {
  const meta = resource.metadata;
  if (resource.kind === 'metric_snapshot') return 'metric';
  if (meta && typeof meta === 'object') {
    if ((meta as any).type === 'live_metric_snapshot' || (meta as any).check_kind === 'live_metric') return 'metric';
    if ((meta as any).check_kind === 'exa_news' || resource.source === 'exa_news' || Array.isArray((meta as any).headlines)) return 'news';
  }
  return null;
}

export function getStructuredResourceBadge(resource: Resource): { label: string; tone: 'metric' | 'news' } | null {
  const kind = getStructuredResourceKind(resource);
  if (kind === 'metric') return { label: 'live metric', tone: 'metric' };
  if (kind === 'news') return { label: 'news feed', tone: 'news' };
  return null;
}

function pillStyles(): CSSProperties {
  return {
    borderColor: 'var(--border)',
    background: 'var(--surface)',
    color: 'var(--ink)',
  };
}

function MetricInlineCard({ resource, isExpanded }: { resource: Resource; isExpanded: boolean }) {
  const meta = (resource.metadata && typeof resource.metadata === 'object') ? (resource.metadata as Record<string, any>) : {};
  const metric = getStructuredMetricPayload(resource) || {};
  const kind = String(metric.kind || meta.metric_kind || '').toLowerCase();
  const provider = String(metric.provider || meta.provider || resource.source || 'market_data');
  const asOf = metric.as_of || metric.observation_date || meta.refreshed_at || resource.created_at;

  const renderPills = (items: Array<{ label: string; value: string | null | undefined }>) => (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
      {items
        .filter((item) => item.value)
        .map((item) => (
          <span key={`${item.label}:${item.value}`} className="pill pill--small" style={pillStyles()}>
            <strong style={{ fontWeight: 600 }}>{item.label}:</strong>&nbsp;{item.value}
          </span>
        ))}
    </div>
  );

  if (kind === 'stock_quote' || kind === 'crypto_quote') {
    const price = formatMetricValue(metric.price, 2);
    const change = formatDelta(metric.change);
    const pct = formatPercent(metric.change_percent);
    const isUp = Number(metric.change_percent) >= 0;
    return (
      <div style={{ border: '1px solid rgba(59, 130, 246, 0.15)', borderRadius: '8px', background: 'linear-gradient(180deg, rgba(59,130,246,0.06), rgba(59,130,246,0.01))', padding: '10px', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
              {kind === 'crypto_quote' ? 'Crypto Snapshot' : 'Ticker Snapshot'}
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2 }}>
              {metric.symbol || (meta.symbol as string) || 'Ticker'}
              {price ? <span style={{ marginLeft: '8px', fontSize: '16px', fontWeight: 600 }}>{price} {metric.currency || ''}</span> : null}
            </div>
            {metric.name ? <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>{metric.name}</div> : null}
          </div>
          {(change || pct) ? (
            <div style={{ fontSize: '12px', fontWeight: 600, color: isUp ? '#15803d' : '#b91c1c', background: isUp ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${isUp ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)'}`, borderRadius: '999px', padding: '4px 8px' }}>
              {[change, pct].filter(Boolean).join(' · ')}
            </div>
          ) : null}
        </div>
        {renderPills([
          { label: 'Provider', value: provider },
          { label: 'As of', value: asOf ? formatTimestampLabel(String(asOf)) : null },
          { label: 'Exchange', value: metric.exchange ? String(metric.exchange) : null },
          { label: 'State', value: metric.market_state ? String(metric.market_state) : null },
          { label: 'Market Cap', value: compactMetricNumber(metric.market_cap) },
          { label: 'Volume', value: compactMetricNumber(metric.volume) },
        ])}
        {isExpanded && (resource.caption || metric.source_delay_note) ? (
          <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--muted)', lineHeight: 1.45 }}>
            {resource.caption}
            {metric.source_delay_note ? <div style={{ marginTop: '6px' }}>{metric.source_delay_note}</div> : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (kind === 'fx_rate') {
    const pair = `${metric.base || ''}/${metric.quote || ''}`.replace(/^\/|\/$/g, '');
    return (
      <div style={{ border: '1px solid rgba(14,165,233,0.14)', borderRadius: '8px', background: 'rgba(14,165,233,0.03)', padding: '10px', marginBottom: '8px' }}>
        <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase' }}>FX Rate Snapshot</div>
        <div style={{ marginTop: '4px', fontSize: '18px', fontWeight: 700, color: 'var(--ink)' }}>
          {pair || 'FX pair'} <span style={{ fontSize: '14px', fontWeight: 600 }}>= {formatMetricValue(metric.rate, 6) || 'N/A'}</span>
        </div>
        {renderPills([
          { label: 'Provider', value: provider },
          { label: 'As of', value: asOf ? formatTimestampLabel(String(asOf)) : null },
          { label: 'Inverse', value: formatMetricValue(metric.inverse_rate, 6) },
        ])}
        {isExpanded && resource.caption ? <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--muted)', lineHeight: 1.45 }}>{resource.caption}</div> : null}
      </div>
    );
  }

  if (kind === 'macro_indicator') {
    return (
      <div style={{ border: '1px solid rgba(16,185,129,0.16)', borderRadius: '8px', background: 'rgba(16,185,129,0.03)', padding: '10px', marginBottom: '8px' }}>
        <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase' }}>Macro Indicator Snapshot</div>
        <div style={{ marginTop: '4px', fontSize: '16px', fontWeight: 700, color: 'var(--ink)' }}>{metric.title || resource.title || 'Indicator'}</div>
        <div style={{ marginTop: '2px', fontSize: '14px', color: 'var(--ink)' }}>
          {formatMetricValue(metric.value, 4) || String(metric.value ?? 'N/A')}{metric.unit ? ` ${metric.unit}` : ''}
        </div>
        {renderPills([
          { label: 'Provider', value: provider },
          { label: 'Series', value: metric.series_id ? String(metric.series_id) : null },
          { label: 'Obs', value: metric.observation_date ? String(metric.observation_date) : null },
          { label: 'As of', value: asOf ? formatTimestampLabel(String(asOf)) : null },
        ])}
        {isExpanded && resource.caption ? <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--muted)', lineHeight: 1.45 }}>{resource.caption}</div> : null}
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--surface)', padding: '10px', marginBottom: '8px' }}>
      <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase' }}>Live Metric Snapshot</div>
      <div style={{ marginTop: '4px', fontSize: '14px', fontWeight: 600, color: 'var(--ink)' }}>{resource.title || metric.title || 'Metric'}</div>
      {resource.caption ? (
        <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--muted)', lineHeight: 1.45 }}>
          {isExpanded || resource.caption.length <= 240 ? resource.caption : `${resource.caption.slice(0, 240)}...`}
        </div>
      ) : null}
    </div>
  );
}

function NewsInlineCard({ resource, isExpanded }: { resource: Resource; isExpanded: boolean }) {
  const headlines = getStructuredNewsHeadlines(resource);
  const visible = isExpanded ? headlines : headlines.slice(0, 4);
  return (
    <div style={{ border: '1px solid rgba(245, 158, 11, 0.18)', borderRadius: '8px', background: 'linear-gradient(180deg, rgba(245,158,11,0.05), rgba(245,158,11,0.01))', padding: '10px', marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>News Feed Snapshot</div>
        <span className="pill pill--small" style={{ borderColor: 'rgba(245,158,11,0.2)', color: '#b45309', background: 'rgba(245,158,11,0.08)' }}>
          {headlines.length} headline{headlines.length === 1 ? '' : 's'}
        </span>
      </div>
      {visible.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {visible.map((headline, idx) => {
            const url = typeof headline.url === 'string' ? headline.url : undefined;
            const title = typeof headline.title === 'string' ? headline.title : `Headline ${idx + 1}`;
            const snippet = typeof headline.snippet === 'string' ? headline.snippet : '';
            const md = headline.metadata && typeof headline.metadata === 'object' ? (headline.metadata as Record<string, any>) : {};
            const published = (md.publishedDate || md.published_date || md.date || md.publishedAt) as string | undefined;
            return (
              <div key={`${title}-${idx}`} style={{ border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--surface)', padding: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
                  {url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ink)', fontWeight: 600, fontSize: '12px', textDecoration: 'none', lineHeight: 1.35 }}>
                      {title}
                    </a>
                  ) : (
                    <div style={{ color: 'var(--ink)', fontWeight: 600, fontSize: '12px', lineHeight: 1.35 }}>{title}</div>
                  )}
                  <span style={{ fontSize: '10px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{getHostnameLabel(url) || 'web'}</span>
                </div>
                {(published || snippet) ? (
                  <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--muted)', lineHeight: 1.35 }}>
                    {published ? `${formatTimestampLabel(published)}${snippet ? ' · ' : ''}` : null}
                    {snippet ? (snippet.length > 180 && !isExpanded ? `${snippet.slice(0, 180)}...` : snippet) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>No headline list metadata found. This may be a generic web/news resource.</div>
      )}
      {resource.caption ? (
        <div style={{ fontSize: '11px', color: 'var(--muted)', lineHeight: 1.4 }}>
          {isExpanded || resource.caption.length <= 260 ? resource.caption : `${resource.caption.slice(0, 260)}...`}
        </div>
      ) : null}
    </div>
  );
}

export function StructuredResourceInlineCard({
  resource,
  isExpanded,
}: {
  resource: Resource;
  isExpanded: boolean;
}) {
  const kind = getStructuredResourceKind(resource);
  if (kind === 'metric') return <MetricInlineCard resource={resource} isExpanded={isExpanded} />;
  if (kind === 'news') return <NewsInlineCard resource={resource} isExpanded={isExpanded} />;
  return null;
}

function MetricReaderView({ resource }: { resource: Resource }) {
  const meta = (resource.metadata && typeof resource.metadata === 'object') ? (resource.metadata as Record<string, any>) : {};
  const metric = getStructuredMetricPayload(resource) || {};
  const kind = String(metric.kind || meta.metric_kind || '').toLowerCase();
  const asOf = metric.as_of || metric.observation_date || meta.refreshed_at || resource.created_at;
  const provider = String(metric.provider || meta.provider || resource.source || 'market_data');

  const pillStyle: CSSProperties = {
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
      {items.filter((i) => i.value).map((i) => (
        <span key={`${i.label}:${i.value}`} style={pillStyle}>
          <strong>{i.label}</strong> {i.value}
        </span>
      ))}
    </div>
  );

  if (kind === 'stock_quote' || kind === 'crypto_quote') {
    const price = formatMetricValue(metric.price, 2);
    const change = formatDelta(metric.change);
    const pct = formatPercent(metric.change_percent);
    const isUp = Number(metric.change_percent) >= 0;
    return (
      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '20px' }}>
        <div style={{ border: '1px solid rgba(59,130,246,0.14)', borderRadius: '12px', background: 'linear-gradient(180deg, rgba(59,130,246,0.06), rgba(59,130,246,0.01))', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {kind === 'crypto_quote' ? 'Crypto Snapshot' : 'Market Quote Snapshot'}
              </div>
              <div style={{ marginTop: '6px', fontSize: '28px', fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1 }}>{metric.symbol || (meta.symbol as string) || 'Ticker'}</div>
              {metric.name ? <div style={{ marginTop: '4px', fontSize: '14px', color: 'var(--muted)' }}>{metric.name}</div> : null}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--ink)' }}>{price || 'N/A'} {metric.currency || ''}</div>
              {(change || pct) ? <div style={{ marginTop: '6px', fontSize: '14px', fontWeight: 600, color: isUp ? '#15803d' : '#b91c1c' }}>{[change, pct].filter(Boolean).join(' · ')}</div> : null}
            </div>
          </div>
          {renderPills([
            { label: 'Provider', value: provider },
            { label: 'As of', value: asOf ? formatTimestampLabel(String(asOf)) : null },
            { label: 'Exchange', value: metric.exchange ? String(metric.exchange) : null },
            { label: 'State', value: metric.market_state ? String(metric.market_state) : null },
            { label: 'Market Cap', value: compactMetricNumber(metric.market_cap) },
            { label: 'Volume', value: compactMetricNumber(metric.volume) },
          ])}
          {(metric.source_delay_note || resource.caption) ? (
            <div style={{ marginTop: '14px', fontSize: '13px', color: 'var(--muted)', lineHeight: 1.55 }}>
              {resource.caption}
              {metric.source_delay_note ? <div style={{ marginTop: '8px' }}>{metric.source_delay_note}</div> : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '860px', margin: '0 auto', padding: '20px' }}>
      <div style={{ border: '1px solid var(--border)', borderRadius: '12px', background: 'var(--surface)', padding: '20px' }}>
        <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase' }}>
          {kind === 'fx_rate' ? 'FX Snapshot' : kind === 'macro_indicator' ? 'Macro Indicator Snapshot' : 'Live Metric Snapshot'}
        </div>
        <div style={{ marginTop: '6px', fontSize: '22px', fontWeight: 700, color: 'var(--ink)' }}>{resource.title || metric.title || 'Metric'}</div>
        {kind === 'fx_rate' ? (
          <div style={{ marginTop: '8px', fontSize: '18px', color: 'var(--ink)' }}>
            {metric.base || ''}/{metric.quote || ''} {formatMetricValue(metric.rate, 6) || ''}
          </div>
        ) : kind === 'macro_indicator' ? (
          <div style={{ marginTop: '8px', fontSize: '18px', color: 'var(--ink)' }}>
            {formatMetricValue(metric.value, 4) || String(metric.value ?? 'N/A')}{metric.unit ? ` ${metric.unit}` : ''}
          </div>
        ) : null}
        {renderPills([
          { label: 'Provider', value: provider },
          { label: 'As of', value: asOf ? formatTimestampLabel(String(asOf)) : null },
          { label: 'Series', value: metric.series_id ? String(metric.series_id) : null },
          { label: 'Observation', value: metric.observation_date ? String(metric.observation_date) : null },
        ])}
        {resource.caption ? <div style={{ marginTop: '14px', fontSize: '13px', color: 'var(--muted)', lineHeight: 1.55 }}>{resource.caption}</div> : null}
      </div>
    </div>
  );
}

function NewsReaderView({ resource }: { resource: Resource }) {
  const headlines = getStructuredNewsHeadlines(resource);
  return (
    <div style={{ maxWidth: '920px', margin: '0 auto', padding: '20px' }}>
      <div style={{ border: '1px solid rgba(245,158,11,0.16)', borderRadius: '12px', background: 'linear-gradient(180deg, rgba(245,158,11,0.04), rgba(245,158,11,0.01))', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>News Feed Snapshot</div>
            <div style={{ marginTop: '6px', fontSize: '20px', fontWeight: 700, color: 'var(--ink)' }}>{resource.title || 'News headlines'}</div>
          </div>
          <span style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '999px', border: '1px solid rgba(245,158,11,0.18)', background: 'rgba(245,158,11,0.08)', color: '#b45309' }}>
            {headlines.length} headline{headlines.length === 1 ? '' : 's'}
          </span>
        </div>
        {resource.caption ? <div style={{ marginTop: '10px', fontSize: '13px', color: 'var(--muted)', lineHeight: 1.55 }}>{resource.caption}</div> : null}
        <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {headlines.length > 0 ? headlines.map((headline, index) => {
            const title = typeof headline.title === 'string' ? headline.title : `Headline ${index + 1}`;
            const url = typeof headline.url === 'string' ? headline.url : undefined;
            const snippet = typeof headline.snippet === 'string' ? headline.snippet : '';
            const metadata = headline.metadata && typeof headline.metadata === 'object' ? (headline.metadata as Record<string, any>) : {};
            const published = metadata.publishedDate || metadata.published_date || metadata.date || metadata.publishedAt;
            return (
              <div key={`${title}-${index}`} style={{ border: '1px solid var(--border)', borderRadius: '10px', background: 'var(--surface)', padding: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
                  {url ? <a href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'var(--ink)', fontWeight: 600, lineHeight: 1.35 }}>{title}</a> : <div style={{ color: 'var(--ink)', fontWeight: 600, lineHeight: 1.35 }}>{title}</div>}
                  <div style={{ fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{getHostnameLabel(url) || 'web'}</div>
                </div>
                {(published || snippet) ? <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--muted)', lineHeight: 1.45 }}>{published ? `${formatTimestampLabel(String(published))}${snippet ? ' · ' : ''}` : null}{snippet || null}</div> : null}
              </div>
            );
          }) : <div style={{ fontSize: '13px', color: 'var(--muted)' }}>No headline metadata found for this resource.</div>}
        </div>
      </div>
    </div>
  );
}

export function StructuredResourceReaderView({ resource }: { resource: Resource }) {
  const kind = getStructuredResourceKind(resource);
  if (kind === 'metric') return <MetricReaderView resource={resource} />;
  if (kind === 'news') return <NewsReaderView resource={resource} />;
  return null;
}

