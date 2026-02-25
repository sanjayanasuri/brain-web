import { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getCorrelationHeaders } from '../../../_utils/correlation';

export const dynamic = 'force-dynamic';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export async function POST(req: NextRequest) {
    const { requestId, headers: correlationHeaders } = getCorrelationHeaders(req);
    try {
        const token = await getToken({ req });
        const accessToken = (token as any)?.accessToken;

        const body = await req.json();

        const backendUrl = `${API_BASE_URL}/ai/chat/stream`;
        console.log(`[Chat Stream Proxy] [${requestId}] Forwarding to ${backendUrl}`);

        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}),
                ...correlationHeaders,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[Chat Stream Proxy] [${requestId}] Backend error (${response.status}):`, errorText);
            return new Response(JSON.stringify({ error: `Backend error: ${response.statusText}`, details: errorText }), {
                status: response.status,
                headers: { 'Content-Type': 'application/json', ...correlationHeaders },
            });
        }

        // Proxy the streaming response
        return new Response(response.body, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                ...correlationHeaders,
            },
        });
    } catch (error: any) {
        console.error(`[Chat Stream Proxy] [${requestId}] Internal error:`, error);
        return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...correlationHeaders },
        });
    }
}
