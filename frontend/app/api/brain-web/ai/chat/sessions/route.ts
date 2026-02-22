import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

export const dynamic = 'force-dynamic';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request });
    const accessToken = (token as any)?.accessToken;

    const backendUrl = new URL(`${API_BASE_URL}/ai/chat/sessions`);
    const limit = new URL(request.url).searchParams.get('limit');
    if (limit) {
      backendUrl.searchParams.set('limit', limit);
    }

    const response = await fetch(backendUrl.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Chat Sessions API] Backend error:', errorText);
      return NextResponse.json(
        { error: 'Failed to fetch chat sessions' },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[Chat Sessions API] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
