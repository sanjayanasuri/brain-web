import { getApiHeaders } from '../api/base';

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Array<{
    id: string;
    question: string;
    answer: string;
    answerId: string | null;
    eventId?: string | null;
    timestamp: number;
    suggestedQuestions?: string[];
    evidenceUsed?: any[];
  }>;
  graphId?: string;
  branchId?: string;
}

const SESSIONS_STORAGE_KEY = 'brainweb:chatSessions';
const MAX_SESSIONS = 50;

/**
 * Generate a title from the first question using LLM
 */
export async function generateSessionTitle(firstQuestion: string): Promise<string> {
  try {
    const response = await fetch('/api/brain-web/chat/title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: firstQuestion }),
    });

    if (!response.ok) {
      throw new Error('Failed to generate title');
    }

    const data = await response.json();
    return data.title || truncateTitle(firstQuestion);
  } catch (err) {
    console.warn('Failed to generate session title, using fallback:', err);
    return truncateTitle(firstQuestion);
  }
}

function truncateTitle(question: string, maxLength: number = 50): string {
  if (question.length <= maxLength) return question;
  return question.substring(0, maxLength - 3) + '...';
}

/**
 * Sync with backend: Fetch all chat sessions
 */
export async function fetchChatSessions(): Promise<ChatSession[]> {
  try {
    const headers = await getApiHeaders();
    const response = await fetch('/api/brain-web/ai/chat/sessions', { headers });
    if (!response.ok) throw new Error('Failed to fetch sessions');
    const data = await response.json();

    const sessions = data.sessions || [];
    // Update local storage
    if (typeof window !== 'undefined') {
      saveChatSessions(sessions);
    }
    return sessions;
  } catch (err) {
    console.warn('Failed to fetch sessions from backend, using local:', err);
    return getChatSessions();
  }
}

/**
 * Sync with backend: Fetch full history for a session
 */
export async function fetchChatHistory(chatId: string): Promise<any[]> {
  try {
    const headers = await getApiHeaders();
    const response = await fetch(`/api/brain-web/ai/chat/history/${chatId}`, { headers });
    if (!response.ok) throw new Error('Failed to fetch history');
    const data = await response.json();
    return data.messages || [];
  } catch (err) {
    console.warn('Failed to fetch history from backend:', err);
    return [];
  }
}

/**
 * Get all chat sessions (local)
 */
export function getChatSessions(): ChatSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

/**
 * Get a specific session by ID (local)
 */
export function getChatSession(sessionId: string): ChatSession | null {
  const sessions = getChatSessions();
  return sessions.find(s => s.id === sessionId) || null;
}

/**
 * Create a new chat session
 */
export async function createChatSession(
  firstQuestion: string,
  firstAnswer: string,
  answerId: string | null = null,
  eventId: string | null = null,
  graphId?: string,
  branchId?: string
): Promise<ChatSession> {
  const title = await generateSessionTitle(firstQuestion);
  const now = Date.now();

  const session: ChatSession = {
    id: `session_${now}_${Math.random().toString(36).substr(2, 9)}`,
    title,
    createdAt: now,
    updatedAt: now,
    messages: [{
      id: `msg_${now}`,
      question: firstQuestion,
      answer: firstAnswer,
      answerId,
      eventId,
      timestamp: now,
    }],
    graphId,
    branchId,
  };

  saveChatSession(session);
  return session;
}

/**
 * Add a message to an existing session
 */
export function addMessageToSession(
  sessionId: string,
  question: string,
  answer: string,
  answerId: string | null = null,
  suggestedQuestions?: string[],
  evidenceUsed?: any[],
  eventId: string | null = null
): void {
  const sessions = getChatSessions();
  const session = sessions.find(s => s.id === sessionId);

  if (!session) {
    console.warn('Session not found:', sessionId);
    return;
  }

  const now = Date.now();
  session.messages.push({
    id: `msg_${now}`,
    question,
    answer,
    answerId,
    eventId,
    timestamp: now,
    suggestedQuestions,
    evidenceUsed,
  });

  session.updatedAt = now;
  saveChatSessions(sessions);
}

/**
 * Update session title
 */
export function updateSessionTitle(sessionId: string, newTitle: string): void {
  const sessions = getChatSessions();
  const session = sessions.find(s => s.id === sessionId);

  if (!session) return;

  session.title = newTitle;
  session.updatedAt = Date.now();
  saveChatSessions(sessions);
}

/**
 * Delete a session
 */
export function deleteChatSession(sessionId: string): void {
  const sessions = getChatSessions();
  const filtered = sessions.filter(s => s.id !== sessionId);
  saveChatSessions(filtered);
}

/**
 * Get the current active session ID (most recently updated)
 */
export function getCurrentSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('brainweb:currentChatSession');
}

/**
 * Set the current active session
 */
export function setCurrentSessionId(sessionId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (sessionId) {
      localStorage.setItem('brainweb:currentChatSession', sessionId);
    } else {
      localStorage.removeItem('brainweb:currentChatSession');
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * Get the current active session
 */
export function getCurrentSession(): ChatSession | null {
  const sessionId = getCurrentSessionId();
  if (!sessionId) return null;
  return getChatSession(sessionId);
}

/**
 * Save a single session
 */
function saveChatSession(session: ChatSession): void {
  const sessions = getChatSessions();
  const existingIndex = sessions.findIndex(s => s.id === session.id);

  if (existingIndex >= 0) {
    sessions[existingIndex] = session;
  } else {
    sessions.push(session);
  }

  saveChatSessions(sessions);
}

/**
 * Save all sessions to storage
 */
function saveChatSessions(sessions: ChatSession[]): void {
  if (typeof window === 'undefined') return;
  try {
    // Sort by updatedAt descending and keep only MAX_SESSIONS
    const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    const trimmed = sorted.slice(0, MAX_SESSIONS);
    localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore storage errors
  }
}
