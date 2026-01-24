import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const graph_id = searchParams.get('graph_id');
    const branch_id = searchParams.get('branch_id');
    const limit_artifacts = searchParams.get('limit_artifacts') || '25';
    const limit_concepts = searchParams.get('limit_concepts') || '25';
    const limit_trails = searchParams.get('limit_trails') || '25';

    if (!graph_id || !branch_id) {
      return NextResponse.json(
        { error: 'graph_id and branch_id are required' },
        { status: 400 }
      );
    }

    // Proxy request to backend
    const backendUrl = new URL(`${API_BASE_URL}/offline/bootstrap`);
    backendUrl.searchParams.set('graph_id', graph_id);
    backendUrl.searchParams.set('branch_id', branch_id);
    backendUrl.searchParams.set('limit_artifacts', limit_artifacts);
    backendUrl.searchParams.set('limit_concepts', limit_concepts);
    backendUrl.searchParams.set('limit_trails', limit_trails);

    // Add timeout to prevent hanging requests (increased for bootstrap which loads large datasets)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout for bootstrap

    let response;
    try {
      response = await fetch(backendUrl.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError' || fetchError.code === 'UND_ERR_HEADERS_TIMEOUT') {
        console.error('[Offline Bootstrap API] Request timeout:', backendUrl.toString());
        return NextResponse.json(
          { error: 'Backend request timed out. Please check if the backend is running.' },
          { status: 504 }
        );
      }
      throw fetchError;
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Offline Bootstrap API] Backend error:', errorText);
      return NextResponse.json(
        { error: 'Failed to fetch bootstrap data' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[Offline Bootstrap API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

