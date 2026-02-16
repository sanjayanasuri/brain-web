import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    return NextResponse.json({
        status: 'ok',
        environment: process.env.NODE_ENV,
        has_api_url: !!process.env.NEXT_PUBLIC_API_URL,
        api_url: process.env.NEXT_PUBLIC_API_URL,
        has_nextauth_secret: !!process.env.NEXTAUTH_SECRET,
        has_nextauth_url: !!process.env.NEXTAUTH_URL,
        nextauth_url: process.env.NEXTAUTH_URL,
    });
}
