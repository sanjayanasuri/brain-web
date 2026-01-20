import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Handle root route redirect
  if (pathname === '/') {
    // Check if there are query params that indicate we should show the explorer
    const hasExplorerParams = 
      searchParams.has('select') || 
      searchParams.has('graph_id') || 
      searchParams.has('chat');

    // If no explorer params, redirect to /home
    if (!hasExplorerParams) {
      const url = new URL('/home', request.url);
      // Preserve any other query params if needed
      return NextResponse.redirect(url, 307); // 307 is temporary redirect, preserves method
    }
    // If there are explorer params, let it through to show the explorer
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match root path specifically
    '/',
    // Also match other paths except static files
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)).*)',
  ],
};
