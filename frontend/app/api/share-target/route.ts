import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

export const dynamic = 'force-dynamic';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request });
    const accessToken = (token as any)?.accessToken;

    const formData = await request.formData();
    const title = formData.get('title') as string || '';
    const text = formData.get('text') as string || '';
    const url = formData.get('url') as string || '';

    const content = [title, text, url].filter(Boolean).join('\n\n');

    if (!content.trim()) {
      return NextResponse.redirect(new URL('/home', request.url));
    }

    // Send to the chat endpoint as a quick capture
    try {
      await fetch(`${API_BASE_URL}/ai/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          message: `Quick capture: ${content}`,
          mode: 'graphrag',
          graph_id: 'default',
          response_prefs: { mode: 'compact' },
        }),
      });
    } catch {
      // Best-effort capture — don't block the redirect
    }

    // Redirect to home with the shared content pre-filled
    const redirectUrl = new URL('/home', request.url);
    redirectUrl.searchParams.set('shared', encodeURIComponent(content.slice(0, 500)));
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error('Share target error:', error);
    return NextResponse.redirect(new URL('/home', request.url));
  }
}
