import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

export const dynamic = 'force-dynamic';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request });
    const accessToken = (token as any)?.accessToken;
    const body = await request.json();

    const canvasId = String(body?.canvas_id || '');
    if (!canvasId) {
      return NextResponse.json({ error: 'canvas_id is required' }, { status: 400 });
    }

    const authHeaders = {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    };

    let existingMetadata: Record<string, any> = {};
    try {
      const detailResp = await fetch(`${API_BASE_URL}/lectures/${encodeURIComponent(canvasId)}`, {
        method: 'GET',
        headers: authHeaders,
        cache: 'no-store',
      });
      if (detailResp.ok) {
        const lecture = await detailResp.json();
        if (lecture?.metadata_json) {
          const parsed = JSON.parse(lecture.metadata_json);
          if (parsed && typeof parsed === 'object') {
            existingMetadata = parsed;
          }
        }
      }
    } catch (error) {
      console.warn('[Canvas Save API] metadata fetch/parse failed, proceeding with fresh metadata', error);
    }

    const freeformCanvas = existingMetadata.freeformCanvas && typeof existingMetadata.freeformCanvas === 'object'
      ? existingMetadata.freeformCanvas
      : {};
    freeformCanvas.state = body?.state || {};
    freeformCanvas.phases = Array.isArray(body?.state?.phases) ? body.state.phases : freeformCanvas.phases || [];
    freeformCanvas.updatedAt = Date.now();
    existingMetadata.freeformCanvas = freeformCanvas;

    const updatePayload: Record<string, any> = {
      metadata_json: JSON.stringify(existingMetadata),
    };
    if (typeof body?.title === 'string' && body.title.trim()) {
      updatePayload.title = body.title.trim();
    }

    const saveResp = await fetch(`${API_BASE_URL}/lectures/${encodeURIComponent(canvasId)}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify(updatePayload),
      cache: 'no-store',
    });

    const text = await saveResp.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { detail: text || 'Unexpected backend response' };
    }
    return NextResponse.json(data, { status: saveResp.status });
  } catch (error) {
    console.error('[Canvas Save API] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
