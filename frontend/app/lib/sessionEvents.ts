import { getAuthHeaders } from './authToken';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export async function emitChatMessageCreated(
  sessionId: string,
  payload: {
    message: string;
    answer: string;
    answer_summary?: string;
    message_id?: string;
  },
  options?: { trace_id?: string; correlation_id?: string }
): Promise<{ event_id: string } | null> {
  const body: Record<string, unknown> = {
    event_type: 'ChatMessageCreated',
    payload,
    idempotency_key: `chat-msg-${sessionId}-${Date.now()}`,
  };
  if (options?.trace_id) body.trace_id = options.trace_id;
  if (options?.correlation_id) body.correlation_id = options.correlation_id;

  const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Failed to emit chat message event');
  }

  const data = await response.json();
  return data?.event_id ? { event_id: data.event_id } : null;
}
