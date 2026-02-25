import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Force dynamic rendering - this API route should not be statically generated
export const dynamic = 'force-dynamic';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request });
    const accessToken = (token as any)?.accessToken;

    const body = await request.json();
    const { page_id, include } = body;

    if (!page_id || typeof include !== 'boolean') {
      return NextResponse.json(
        { error: 'page_id and include (boolean) are required' },
        { status: 400 }
      );
    }

    const response = await fetch(`${API_BASE_URL}/admin/notion/pages/index`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ page_id, include }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Backend error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Notion page index API error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
