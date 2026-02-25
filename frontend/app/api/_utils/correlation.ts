import type { NextRequest } from 'next/server';

export function createRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return uuid.replace(/-/g, '');
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`.slice(
    0,
    32
  );
}

export function getCorrelationHeaders(request: NextRequest): {
  requestId: string;
  headers: Record<string, string>;
} {
  const incomingRequestId = request.headers.get('x-request-id')?.trim();
  const requestId = incomingRequestId && incomingRequestId.length > 0 ? incomingRequestId : createRequestId();
  const sessionId = request.headers.get('x-session-id')?.trim();

  return {
    requestId,
    headers: {
      'x-request-id': requestId,
      ...(sessionId ? { 'x-session-id': sessionId } : {}),
    },
  };
}

