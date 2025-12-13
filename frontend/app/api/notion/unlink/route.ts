import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { page_id } = body;

    if (!page_id) {
      return NextResponse.json(
        { error: 'page_id is required' },
        { status: 400 }
      );
    }

    const response = await fetch(`${API_BASE_URL}/admin/notion/unlink-page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_id }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Backend error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Notion unlink API error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
