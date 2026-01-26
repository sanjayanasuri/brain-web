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
      const url = request.nextUrl.clone();
      url.pathname = '/home';
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
