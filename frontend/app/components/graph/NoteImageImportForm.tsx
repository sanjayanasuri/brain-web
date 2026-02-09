'use client';

import { useRef, useState } from 'react';
import type { NoteImageIngestResponse, OCRBlock } from '../../api-client';
import { ingestNoteImage } from '../../api-client';

function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

function loadImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = dataUrl;
    });
}

export default function NoteImageImportForm({
    activeGraphId,
    activeBranchId,
    onClose,
}: {
    activeGraphId: string;
    activeBranchId: string;
    onClose: () => void;
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [title, setTitle] = useState('Whiteboard Photo');
    const [domain, setDomain] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [stage, setStage] = useState<string>('');
    const [result, setResult] = useState<NoteImageIngestResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handlePickFile = () => {
        setError(null);
        setResult(null);
        fileInputRef.current?.click();
    };

    const handleFileSelected = async (file: File) => {
        setIsLoading(true);
        setError(null);
        setResult(null);
        setStage('Reading image…');
        try {
            const dataUrl = await fileToDataUrl(file);
            const { width, height } = await loadImageDimensions(dataUrl);

            setStage('Running OCR…');
            let extractedText = '';
            let ocrBlocks: OCRBlock[] = [];
            try {
                // @ts-ignore - tesseract.js is dynamic
                const { createWorker } = await import('tesseract.js');
                const worker = await createWorker('eng');
                const ret = await worker.recognize(dataUrl);
                const dataAny = (ret as any)?.data || {};
                extractedText = String(dataAny?.text || '');

                const lines = (dataAny?.lines || []) as any[];
                const words = (dataAny?.words || []) as any[];
                const src = (lines && lines.length > 0) ? lines : words;

                ocrBlocks = (src || [])
                    .map((item: any) => {
                        const text = String(item?.text || '').trim();
                        if (!text) return null;
                        const bbox = item?.bbox;
                        if (!bbox) return null;

                        const x0 = Number(bbox.x0);
                        const y0 = Number(bbox.y0);
                        const x1 = Number(bbox.x1);
                        const y1 = Number(bbox.y1);
                        if (![x0, y0, x1, y1].every(n => Number.isFinite(n))) return null;

                        return {
                            text,
                            confidence: typeof item?.confidence === 'number' ? item.confidence : null,
                            bbox: {
                                x: x0,
                                y: y0,
                                w: Math.max(0, x1 - x0),
                                h: Math.max(0, y1 - y0),
                                unit: 'px',
                                image_width: width,
                                image_height: height,
                            },
                        } as OCRBlock;
                    })
                    .filter(Boolean) as OCRBlock[];

                await worker.terminate();
            } catch (e) {
                console.warn('[NoteImageImport] OCR failed, uploading image with no bbox blocks:', e);
                ocrBlocks = [];
            }

            setStage('Uploading…');
            const resp = await ingestNoteImage({
                image_data: dataUrl,
                title: title || 'Whiteboard Photo',
                domain: domain || undefined,
                graph_id: activeGraphId,
                branch_id: activeBranchId,
                ocr_engine: 'tesseract.js',
                ocr_hint: extractedText || undefined,
                ocr_blocks: ocrBlocks.length > 0 ? ocrBlocks : undefined,
            });

            setResult(resp);
            setStage('');
        } catch (err: any) {
            console.error('[NoteImageImport] Ingest failed:', err);
            setError(err?.message || 'Ingestion failed.');
            setStage('');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div>
            <div style={{ marginBottom: '8px' }}>
                <input
                    type="text"
                    id="note-image-title"
                    name="note-image-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Title"
                    style={{
                        width: '100%',
                        padding: '6px 8px',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        fontSize: '13px',
                    }}
                />
            </div>

            <div style={{ marginBottom: '8px' }}>
                <input
                    type="text"
                    id="note-image-domain"
                    name="note-image-domain"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="Topic or domain (optional)"
                    style={{
                        width: '100%',
                        padding: '6px 8px',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        fontSize: '13px',
                    }}
                />
            </div>

            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelected(f);
                    // Allow re-selecting the same file
                    e.currentTarget.value = '';
                }}
            />

            {result && (
                <div style={{
                    marginBottom: '8px',
                    padding: '6px 8px',
                    backgroundColor: '#efe',
                    border: '1px solid #cfc',
                    borderRadius: '4px',
                    fontSize: '12px',
                    lineHeight: 1.4,
                }}>
                    ✓ Ingested {result.blocks?.length || 0} blocks
                    {result.warnings?.length ? (
                        <div style={{ marginTop: '6px', color: 'var(--muted)' }}>
                            {result.warnings.slice(0, 2).map((w, i) => (
                                <div key={i}>• {w}</div>
                            ))}
                        </div>
                    ) : null}
                </div>
            )}

            {error && (
                <div style={{
                    marginBottom: '8px',
                    padding: '6px 8px',
                    backgroundColor: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.25)',
                    borderRadius: '4px',
                    fontSize: '12px',
                    color: '#b91c1c',
                }}>
                    {error}
                </div>
            )}

            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <button
                    type="button"
                    onClick={handlePickFile}
                    disabled={isLoading}
                    className="pill pill--small"
                    style={{
                        flex: 1,
                        backgroundColor: isLoading ? '#ccc' : 'var(--accent)',
                        color: 'white',
                        border: 'none',
                        cursor: isLoading ? 'not-allowed' : 'pointer',
                    }}
                >
                    {isLoading ? (stage || 'Working…') : 'Choose Photo'}
                </button>
                <button
                    type="button"
                    onClick={onClose}
                    className="pill pill--ghost pill--small"
                    style={{ cursor: 'pointer' }}
                >
                    Close
                </button>
            </div>
        </div>
    );
}
