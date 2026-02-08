import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import {
  queryRouterAgent,
  profileUpdateAgent,
  runQualityAgentsInParallel,
  refinementAgent,
  type FactCheckResult,
  type CoherenceResult,
  type ValidationResult,
} from '../agents';
import {
  buildOptimizedContext,
  truncateContextIntelligently,
  extractKeyContext,
  type ContextChunk,
} from '../context-manager';
import {
  recordFailure,
  getFailureStats,
  learnFromFailures,
  type FailureRecord,
} from '../failure-learning';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

// In Next.js, environment variables without NEXT_PUBLIC_ prefix are only available server-side
// OPENAI_API_KEY should be in .env.local (not .env.local.public)
// Note: Next.js caches env vars at build time, so restart dev server after changing .env.local

// Web search logic is now consolidated into queryRouterAgent in agents.ts


/**
 * Perform web search and fetch full content using Brain Web's native web search API
 * 
 * Uses SearXNG to search, then fetches full content from links.
 * This provides comprehensive information by actually scraping the pages, not just snippets.
 * 
 * Flow:
 * 1. Calls backend /web-search/search-and-fetch endpoint (searches via SearXNG and fetches full content)
 * 2. Falls back to /web-search/search if search-and-fetch fails (returns links only)
 * 
 * Benefits:
 * - Native Brain Web integration (no external dependencies)
 * - SearXNG aggregates multiple search engines (Google, Bing, DuckDuckGo, Brave, etc.)
 * - Full content extraction (Trafilatura - Firecrawl-quality)
 * - Privacy-respecting (no tracking)
 * - Self-hostable (full control)
 */
async function performWebSearch(query: string, graph_id: string = 'default'): Promise<{
  results: Array<{
    title: string;
    snippet: string;
    link: string;
    fullContent?: string;
    graph?: any;
  }>;
  answer?: string; // New: capture agentic answer if available
  error?: string;
}> {
  const backendUrl = API_BASE_URL;

  try {
    // Attempt native deep research first
    const researchResponse = await fetch(
      `${backendUrl}/web-search/research?query=${encodeURIComponent(query)}&active_graph_id=${graph_id}`,
      {
        method: 'POST',
        headers: getBackendHeaders(),
      }
    );

    if (researchResponse.ok) {
      const data = await researchResponse.json();
      console.log(`[Chat API] Native Research Agent Answered: ${data.answer?.substring(0, 50)}...`);

      const results = (data.sources || []).map((s: any) => ({
        title: s.title || '',
        snippet: s.content?.substring(0, 200) || '',
        link: s.url || '',
        fullContent: s.content,
      }));

      return {
        results,
        answer: data.answer // Returning the full answer from the research agent
      };
    }
  } catch (err) {
    console.warn('[Chat API] Native research failed, falling back to search-and-fetch:', err);
  }

  // Fallback to legacy search-and-fetch
  const searchAndFetchController = new AbortController();
  const searchAndFetchTimeout = setTimeout(() => searchAndFetchController.abort(), 30000);

  try {
    const searchAndFetchResponse = await fetch(
      `${backendUrl}/web-search/search-and-fetch?query=${encodeURIComponent(query)}&num_results=3&max_content_length=10000`,
      {
        signal: searchAndFetchController.signal,
        headers: getBackendHeaders(),
      }
    );
    clearTimeout(searchAndFetchTimeout);

    if (searchAndFetchResponse.ok) {
      const data = await searchAndFetchResponse.json();
      const results = (data.results || []).map((item: any) => ({
        title: item.search_result?.title || item.fetched_content?.title || '',
        snippet: item.search_result?.snippet || item.fetched_content?.content?.substring(0, 200) || '',
        link: item.search_result?.url || '',
        fullContent: item.fetched_content?.content,
      }));
      return { results };
    }
  } catch (err: any) {
    clearTimeout(searchAndFetchTimeout);
    console.error('[Chat API] Web search failed:', err);
  }

  return {
    results: [],
    error: 'Web search failed.'
  };
}

function getOpenAIApiKey(): string | undefined {
  // Try to read directly from .env.local file as a fallback
  // Priority: 1) process.env, 2) repo root .env.local (matches backend), 3) frontend/.env.local
  let key = process.env.OPENAI_API_KEY;

  // If key is too short or missing, try reading from file directly
  if (!key || key.length < 20) {
    try {

      // First try repo root .env.local (same as backend uses)
      const repoRootEnvPath = path.join(process.cwd(), '..', '.env.local');
      if (fs.existsSync(repoRootEnvPath)) {
        const content = fs.readFileSync(repoRootEnvPath, 'utf8');
        const match = content.match(/^OPENAI_API_KEY=(.+)$/m);
        if (match && match[1]) {
          key = match[1].trim();
          console.log('[Chat API] Read API key from repo root .env.local (matches backend)');
        }
      }

      // Fallback to frontend/.env.local if repo root doesn't have it
      if (!key || key.length < 20) {
        const frontendEnvPath = path.join(process.cwd(), '.env.local');
        if (fs.existsSync(frontendEnvPath)) {
          const content = fs.readFileSync(frontendEnvPath, 'utf8');
          const match = content.match(/^OPENAI_API_KEY=(.+)$/m);
          if (match && match[1]) {
            key = match[1].trim();
            console.log('[Chat API] Read API key from frontend/.env.local');
          }
        }
      }
    } catch (err) {
      console.warn('[Chat API] Could not read .env.local directly:', err);
    }
  }

  if (!key) {
    console.error('[Chat API] OPENAI_API_KEY not found in environment variables');
    console.error('[Chat API] Make sure you have OPENAI_API_KEY in one of:');
    console.error('[Chat API]   1. Repo root .env.local (recommended - matches backend)');
    console.error('[Chat API]   2. frontend/.env.local');
    console.error('[Chat API] Format: OPENAI_API_KEY=sk-proj-... (no quotes, no spaces around =)');
    console.error('[Chat API] Note: Next.js requires server-side env vars to NOT have NEXT_PUBLIC_ prefix');
    console.error('[Chat API] IMPORTANT: Restart the Next.js dev server after changing .env.local');
    return undefined;
  }

  // Trim any whitespace that might have been introduced
  const trimmedKey = key.trim();

  if (trimmedKey.length < 20) {
    console.error(`[Chat API] ERROR: API key is too short (${trimmedKey.length} chars). Expected ~164 chars.`);
    console.error(`[Chat API] Key preview: ${trimmedKey.substring(0, 20)}...`);
    console.error('[Chat API] This usually means:');
    console.error('[Chat API]   1. The key was truncated in .env.local (check for line breaks)');
    console.error('[Chat API]   2. The dev server needs to be restarted');
    console.error('[Chat API]   3. There are special characters or quotes in the key');
    console.error('[Chat API]   4. There is an environment variable set in your shell overriding it');
    console.error('[Chat API] Try: unset OPENAI_API_KEY (then restart dev server)');
  } else {
    console.log(`[Chat API] ✓ OpenAI API key loaded (length: ${trimmedKey.length})`);
  }

  return trimmedKey;
}

/**
 * Generate a dev authentication token for backend API requests.
 * Uses the same default secret as the backend for local development.
 */
function getDevAuthToken(): string {
  // Use the same default secret as backend/auth.py for local dev
  const secret = process.env.API_TOKEN_SECRET || 'dev-secret-key-change-in-production';

  // Generate a token with default user/tenant for local dev
  const payload = {
    user_id: 'dev-user',
    tenant_id: 'dev-tenant',
    exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // 30 days
    iat: Math.floor(Date.now() / 1000),
  };

  return jwt.sign(payload, secret, { algorithm: 'HS256' });
}

/**
 * Get headers for backend API requests, including authentication.
 */
function getBackendHeaders(): Record<string, string> {
  const authToken = getDevAuthToken();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
  };
}

interface Concept {
  node_id: string;
  name: string;
  domain: string;
  type: string;
  description?: string | null;
  tags?: string[] | null;
}

interface SemanticSearchResponse {
  nodes: Concept[];
  scores: number[];
}

interface ResponsePreferences {
  mode?: 'compact' | 'hint' | 'normal' | 'deep';
  max_output_tokens?: number;
  ask_question_policy?: 'never' | 'at_most_one' | 'ok';
  end_with_next_step?: boolean;
}

interface ChatHistoryMessage {
  id: string;
  question: string;
  answer: string;
  timestamp: number;
}

interface ChatRequest {
  message: string;
  context_text?: string;
  mode?: 'classic' | 'graphrag' | 'assessment';
  graph_id?: string;
  branch_id?: string;
  lecture_id?: string | null;
  vertical?: 'general' | 'finance';
  lens?: string;
  recency_days?: number;
  evidence_strictness?: 'high' | 'medium' | 'low';
  include_proposed_edges?: boolean;
  response_prefs?: ResponsePreferences;
  voice_id?: string;
  chatHistory?: ChatHistoryMessage[]; // Conversation history for context
  trail_id?: string;
  focus_concept_id?: string;
  focus_quote_id?: string;
  focus_page_url?: string;
  image?: string; // Base64 data URL for vision context
  ui_context?: {
    dom_path?: string;
    position?: { top: number; left: number; width: number; height: number };
    react_component?: string;
    html_element?: string;
  };
  forceWebSearch?: boolean; // Manual override from UI toggle
}

interface SuggestedAction {
  type: 'link' | 'add';
  source?: string;
  target?: string;
  concept?: string;
  domain?: string;
  label: string;
}

interface EvidenceItem {
  id?: string;
  title: string;
  url?: string | null;
  source: string;
  as_of?: string | number | null;
  snippet?: string | null;
  resource_id?: string | null;
  concept_id?: string | null;
}

interface AnswerSection {
  id: string;
  heading?: string;
  text: string;
  supporting_evidence_ids: string[];
}

interface ChatResponse {
  answer: string;
  usedNodes: Concept[];
  suggestedQuestions: string[];
  suggestedActions?: SuggestedAction[];
  answerId?: string;
  retrievalMeta?: {
    communities: number;
    claims: number;
    concepts: number;
    edges: number;
    sourceBreakdown?: Record<string, number>;
    claimIds?: string[];
    communityIds?: string[];
    topClaims?: Array<{
      claim_id: string;
      text: string;
      confidence?: number;
      source_id?: string;
      published_at?: string;
    }>;
  };
  evidenceUsed?: EvidenceItem[];
  answer_sections?: AnswerSection[];
  graph_data?: any;
  webSearchResults?: Array<{ title: string; snippet: string; link: string; fullContent?: string; graph?: any }>;
  meta?: {
    draftAnswer?: string;
    rewriteApplied: boolean;
    examplesUsed?: Array<{
      question: string;
      snippet: string;
    }>;
    mode?: string;
    duration_ms?: number;
    intent?: any;
    traceSteps?: any;
    trace?: {
      used_trail_steps: Array<{ step_id: string; kind: string; ref_id: string; title?: string; created_at?: number }>;
      used_concepts: string[];
      used_quotes: string[];
      used_claims: string[];
      used_sources: Array<{ title?: string; url?: string }>;
      retrieval_plan?: string;
      retrieval_latency_ms?: number;
      evidence_strictness?: 'high' | 'medium' | 'low';
    };
  };
}

/**
 * PromptBuilder: Composes system prompts with stable contract + voice + mode
 */
function buildPrompt(
  basePrompt: string,
  responsePrefs: ResponsePreferences,
  voiceId: string = 'neutral',
  userProfile?: any,
  additionalLayers?: string[]
): { systemPrompt: string; maxTokens: number } {
  const prefs = {
    mode: responsePrefs.mode || 'compact',
    max_output_tokens: responsePrefs.max_output_tokens,
    ask_question_policy: responsePrefs.ask_question_policy || 'at_most_one',
    end_with_next_step: responsePrefs.end_with_next_step !== false,
  };

  const contract = `
RESPONSE CONTRACT (MUST FOLLOW):
- Default mode: ${prefs.mode === 'compact' ? 'succinct, conversational, one step at a time' : prefs.mode === 'hint' ? 'brief nudge only' : prefs.mode === 'deep' ? 'structured with clear sections' : 'balanced explanation'}
- Ask at most ${prefs.ask_question_policy === 'never' ? 'zero' : prefs.ask_question_policy === 'at_most_one' ? 'one' : 'questions as needed'} question${prefs.ask_question_policy === 'at_most_one' ? '' : 's'} unless blocked
- ${prefs.end_with_next_step ? 'End with a concise micro-next-step or fork.' : 'End naturally and abruptly.'}
- NEVER use enthusiastic fillers like "I hope this helps", "Let me know if you have questions", or "Looking forward to it".
- Be direct. Avoid repetitive polite closings.
`;

  const voiceCards: Record<string, string> = {
    neutral: 'Tone: Professional and clear.',
    friendly: 'Tone: Warm and approachable.',
    direct: 'Tone: Straightforward and no-nonsense.',
    playful: 'Tone: Light and engaging.',
  };
  const voiceCard = voiceCards[voiceId] || voiceCards.neutral;

  const modeInstructions: Record<string, string> = {
    compact: `OUTPUT FORMAT: 1-2 paragraphs maximum. Be concise.`,
    hint: `OUTPUT FORMAT: One brief nudge (1-2 sentences).`,
    normal: `OUTPUT FORMAT: Balanced explanation.`,
    deep: `OUTPUT FORMAT: Structured response with clear sections.`,
  };
  const modeInstruction = modeInstructions[prefs.mode] || modeInstructions.normal;

  // New Dynamic Style Guide (replaces hardcoded Sanjay guide)
  const styleGuide = `
STYLE GUIDE:
- Adopt a direct and helpful tone. Avoid hyperbolic or overly enthusiastic fillers.
- STREAKY DIRECTNESS: No "I hope this helps" or "Let me know if you need anything else."
- No unnecessary transitions or formal headers unless requested.
- Use the User Profile to adapt your explanations and tone.
- Integrate knowledge and analogies naturally.
`;

  // Compose final prompt
  let systemPrompt = basePrompt + '\n\n' + contract + '\n' + voiceCard + '\n' + modeInstruction + '\n' + styleGuide;

  if (userProfile) {
    systemPrompt += `\nUSER PREFERENCES (ADAPT TO THESE):\n${JSON.stringify(userProfile)}`;
  }

  if (additionalLayers) {
    additionalLayers.forEach(layer => {
      systemPrompt += '\n' + layer;
    });
  }

  const maxTokens = prefs.max_output_tokens || (
    prefs.mode === 'compact' ? 800 :
      prefs.mode === 'hint' ? 100 :
        2000
  );

  return { systemPrompt, maxTokens };
}

/**
 * Post-processing guardrails to enforce response preferences
 */
function enforceGuardrails(
  answer: string,
  responsePrefs: ResponsePreferences,
  wasTruncated: boolean = false
): string {
  const prefs = {
    mode: responsePrefs.mode || 'compact',
    ask_question_policy: responsePrefs.ask_question_policy || 'at_most_one',
  };

  let processed = answer;

  // Enforce natural endings by stripping common repetitive polite fillers
  const annoyingEndings = [
    /Let me know if you have any (other )?questions\.?/i,
    /I hope this helps\.?/i,
    /Feel free to ask if you need more (info|details)\.?/i,
    /Happy to help\.?/i,
  ];

  annoyingEndings.forEach(pattern => {
    processed = processed.replace(pattern, '').trim();
  });

  // Enforce hint mode: max 2 lines, no multi-step plans
  if (prefs.mode === 'hint') {
    const lines = processed.split('\n').filter(l => l.trim().length > 0);
    if (lines.length > 2) {
      processed = lines.slice(0, 2).join('\n');
    }
    // Remove bullet points and numbered lists (multi-step plans)
    processed = processed.replace(/^[\s]*[-•*]\s+/gm, '');
    processed = processed.replace(/^\d+\.\s+/gm, '');
  }

  // Enforce compact mode: limit length, but be smarter about it
  // Skip truncation if OpenAI already truncated the response
  if (prefs.mode === 'compact' && !wasTruncated) {
    const lines = processed.split('\n').filter(l => l.trim().length > 0);
    // Don't truncate if response seems incomplete (ends with colon, dash, or "and")
    const lastLine = lines[lines.length - 1] || '';
    const seemsIncomplete = lastLine.trim().endsWith(':') ||
      lastLine.trim().endsWith('-') ||
      lastLine.trim().endsWith('and') ||
      lastLine.trim().endsWith('are:') ||
      lastLine.trim().endsWith('types:');

    // Allow up to 6 lines if response seems incomplete, otherwise limit to 4
    const maxLines = seemsIncomplete ? 6 : 4;
    if (lines.length > maxLines && !seemsIncomplete) {
      processed = lines.slice(0, maxLines).join('\n');
    }
  }

  // Enforce question policy
  if (prefs.ask_question_policy === 'never') {
    // Remove all questions
    processed = processed.replace(/\?[^?]*\?/g, '');
    processed = processed.replace(/[^?]*\?/g, (match) => match.replace(/\?$/, '.'));
  } else if (prefs.ask_question_policy === 'at_most_one') {
    // Count question marks
    const questionCount = (processed.match(/\?/g) || []).length;
    if (questionCount > 1) {
      // Keep only the first question
      const parts = processed.split('?');
      processed = parts.slice(0, 2).join('?') + (parts.length > 2 ? parts.slice(2).join('.').replace(/\?/g, '.') : '');
    }
  }

  return processed.trim();
}

// Simple in-memory cache to handle rapid-fire identical queries
const chatCache = new Map<string, { response: any, timestamp: number }>();
const CHAT_CACHE_TTL = 30000; // 30 seconds

export async function POST(request: NextRequest) {
  try {
    // Get API key at request time (not module load time) to ensure fresh value
    const apiKey = getOpenAIApiKey();

    const body: ChatRequest = await request.json();

    // Check cache for identical query
    const cacheKey = JSON.stringify({
      message: body.message,
      graph_id: body.graph_id || 'default',
      branch_id: body.branch_id || 'main',
      mode: body.mode || 'graphrag',
      prefs: body.response_prefs
    });

    const cached = chatCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CHAT_CACHE_TTL) {
      console.log(`[Chat API] Serving cached response for: "${body.message.substring(0, 30)}..."`);
      return NextResponse.json(cached.response);
    }
    // Always use GraphRAG - it's superior to classic mode in all cases
    // Mode parameter is deprecated but kept for backward compatibility
    const { message: initialMessage, mode = 'graphrag', graph_id, branch_id, lecture_id, vertical: initialVertical, lens: initialLens, recency_days, evidence_strictness, include_proposed_edges, response_prefs, voice_id, chatHistory, trail_id, focus_concept_id, focus_quote_id, focus_page_url, image, ui_context } = body;
    let message = initialMessage;
    let vertical = initialVertical;
    let lens = initialLens;

    // Default ResponsePreferences if not provided
    const defaultResponsePrefs: ResponsePreferences = {
      mode: 'compact',
      ask_question_policy: 'at_most_one',
      end_with_next_step: true,
    };
    const finalResponsePrefs: ResponsePreferences = { ...defaultResponsePrefs, ...(response_prefs || {}) };
    const finalVoiceId = voice_id || 'neutral';

    // Handle finance: prefix
    if (message.toLowerCase().startsWith('finance:')) {
      vertical = 'finance';
      message = message.substring(8).trim(); // Remove "finance:" prefix

      // Parse lens from message if present (e.g., "finance: NVIDIA lens=competition")
      const lensMatch = message.match(/lens=(\w+)/i);
      if (lensMatch) {
        lens = lensMatch[1];
        message = message.replace(/lens=\w+/i, '').trim(); // Remove lens= part
      }
    }

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required and must be a string' },
        { status: 400 }
      );
    }

    if (!apiKey) {
      console.error('[Chat API] OPENAI_API_KEY not set in environment variables');
      console.error('[Chat API] Make sure you have OPENAI_API_KEY in frontend/.env.local');
      console.error('[Chat API] Format: OPENAI_API_KEY=sk-proj-...');
      return NextResponse.json(
        {
          error: 'OpenAI API key not configured',
          answer: "I'm unable to process your question because the OpenAI API key is not configured. Please check frontend/.env.local",
          usedNodes: [],
          suggestedQuestions: [],
        },
        { status: 500 }
      );
    }

    // Use the runtime-loaded key
    const OPENAI_API_KEY = apiKey;

    const startTime = Date.now();
    console.log(`[Chat API] Processing question: "${message.substring(0, 50)}..." (always using GraphRAG)`);

    // Check for Assessment/Study Mode
    if ((vertical as string) === 'study' || (body as any).mode === 'assessment') {
      console.log('[Chat API] Routing to Assessment Agent...');

      // Determine action: probe or evaluate
      // If the user's message is short/imperative ("Quiz me on X"), it's a probe request.
      // If it's a response to a question, it's an evaluate request.
      // For simplicity in this v1: 
      // - If message starts with "Quiz me" or "Assess", it's a PROBE.
      // - Otherwise, assume EVALUATE (if context implies active assessment).

      let action = 'evaluate';
      let conceptName = 'General Knowledge'; // Fallback

      // Heuristic for probing
      if (message.toLowerCase().startsWith('quiz me') || message.toLowerCase().includes('assess my knowledge')) {
        action = 'probe';
        // Extract concept (e.g., "Quiz me on Machine Learning")
        const match = message.match(/on (.+)$/i);
        if (match) conceptName = match[1];
      } else if (message.startsWith('Tutor me on this:')) {
        action = 'contextual_probe';
        // Extract the selected text
        const match = message.match(/Tutor me on this: "(.+)"/);
        if (match) {
          // We use the extracted text as the "text_selection" payload
          // Ideally we should also pass the full context from the editor, but for MVP this string is enough
          // The "conceptName" variable is repurposed to hold the selection here temporarily or ignored
          conceptName = match[1];
        }
      }

      // Call Assessment Endpoint
      const assessResponse = await fetch(`${API_BASE_URL}/ai/assess`, {
        method: 'POST',
        headers: getBackendHeaders(),
        body: JSON.stringify({
          action,
          concept_name: conceptName,
          concept_id: 'unknown', // specific ID not critical for v1 probe
          current_mastery: 50, // Default for now, ideally fetch from profile
          graph_id: body.graph_id || 'default',
          question: action === 'evaluate' ? "Previous Question Placeholder" : undefined, // Need state for proper eval
          user_answer: action === 'evaluate' ? message : undefined,
          history: chatHistory,
          // For contextual probe
          text_selection: action === 'contextual_probe' ? conceptName : undefined,
          context: action === 'contextual_probe' ? (body.context_text || "User Notes Context") : undefined
        })
      });

      if (assessResponse.ok) {
        const assessmentData = await assessResponse.json();
        const responseText = action === 'probe'
          ? assessmentData.next_question
          : `${assessmentData.feedback}\n\n**New Mastery Score:** ${assessmentData.mastery_score}/100\n\n${assessmentData.next_question ? "Next Question: " + assessmentData.next_question : ""}`;

        return NextResponse.json({
          answer: responseText,
          usedNodes: [],
          suggestedQuestions: [],
          meta: { mode: 'assessment', duration_ms: Date.now() - startTime }
        });
      }
    }

    // Always use GraphRAG mode - it's superior in all cases
    const result = await handleGraphRAGMode(message, graph_id, branch_id, lecture_id, apiKey, vertical, lens, recency_days, evidence_strictness, include_proposed_edges, finalResponsePrefs, finalVoiceId, chatHistory, trail_id, focus_concept_id, focus_quote_id, focus_page_url, image, ui_context, (body as any).forceWebSearch);

    // Cache the successful response
    try {
      const resultJson = await result.clone().json();
      const cacheKey = JSON.stringify({
        message,
        graph_id: graph_id || 'default',
        branch_id: branch_id || 'main',
        mode: body.mode || 'graphrag',
        prefs: body.response_prefs
      });
      chatCache.set(cacheKey, { response: resultJson, timestamp: Date.now() });
    } catch (e) {
      console.warn('[Chat API] Failed to cache response:', e);
    }

    const totalDuration = Date.now() - startTime;
    console.log(`[Chat API] GraphRAG mode completed in ${totalDuration}ms`);
    return result;
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
        answer: "I encountered an error while processing your question. Please try again.",
        usedNodes: [],
        suggestedQuestions: [],
      },
      { status: 500 }
    );
  }
}

/**
 * Extract key topics from conversation history for context summary
 */
function extractConversationTopics(chatHistory: ChatHistoryMessage[]): string[] {
  if (!chatHistory || chatHistory.length === 0) return [];

  const topics = new Set<string>();
  const recentHistory = chatHistory.slice(-5); // Last 5 exchanges for topic extraction

  for (const hist of recentHistory) {
    // Extract potential topics from questions (simple keyword extraction)
    const questionWords = hist.question.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 4 && !['what', 'how', 'when', 'where', 'which', 'about', 'does', 'would', 'could'].includes(w));

    // Take first 2-3 significant words as potential topics
    if (questionWords.length > 0) {
      const topic = questionWords.slice(0, 2).join(' ');
      if (topic.length > 3) topics.add(topic);
    }
  }

  return Array.from(topics).slice(0, 5); // Max 5 topics
}

/**
 * Build conversation summary from recent history
 */
function buildConversationSummary(chatHistory: ChatHistoryMessage[]): string {
  if (!chatHistory || chatHistory.length === 0) return '';

  const recentHistory = chatHistory.slice(-3); // Last 3 exchanges
  const topics = extractConversationTopics(recentHistory);

  if (topics.length === 0) return '';

  return `Recent conversation topics: ${topics.join(', ')}`;
}

/**
 * Build messages array with conversation history for OpenAI API
 */
function buildMessagesWithHistory(
  systemPrompt: string,
  currentMessage: string,
  contextString: string,
  chatHistory?: ChatHistoryMessage[],
  conversationSummary?: string,
  userProfile?: any,
  uiContext?: ChatRequest['ui_context'],
  image?: string
): Array<{ role: 'system' | 'user' | 'assistant'; content: string | any[] }> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string | any[] }> = [
    { role: 'system', content: systemPrompt },
  ];

  // Add conversation history (limit to last 10 exchanges to avoid token limits)
  if (chatHistory && chatHistory.length > 0) {
    const recentHistory = chatHistory.slice(-10); // Last 10 Q&A pairs
    for (const hist of recentHistory) {
      messages.push({ role: 'user', content: hist.question });
      messages.push({ role: 'assistant', content: hist.answer });
    }
  }

  // Build enhanced current message with context
  let messageContent = `Question: ${currentMessage}`;

  // Add UI context if available (what the user is currently looking at)
  if (uiContext) {
    const uiContextParts: string[] = [];
    if (uiContext.react_component) {
      uiContextParts.push(`React Component: ${uiContext.react_component}`);
    }
    if (uiContext.dom_path) {
      uiContextParts.push(`DOM Path: ${uiContext.dom_path}`);
    }
    if (uiContext.position) {
      uiContextParts.push(`Position: top=${uiContext.position.top}px, left=${uiContext.position.left}px, width=${uiContext.position.width}px, height=${uiContext.position.height}px`);
    }
    if (uiContextParts.length > 0) {
      messageContent += `\n\nUSER INTERFACE CONTEXT: The user is currently viewing/interacting with: ${uiContextParts.join(' | ')}. Consider this when providing your response.`;
    }
  }

  // Add conversation summary if available
  if (conversationSummary) {
    messageContent += `\n\nCONVERSATION CONTEXT: ${conversationSummary}`;
  }

  // Add user profile context if available
  if (userProfile) {
    const profileContext: string[] = [];
    if (userProfile.name) profileContext.push(`Name: ${userProfile.name}`);
    if (userProfile.background && userProfile.background.length > 0) {
      profileContext.push(`Background: ${userProfile.background.join(', ')}`);
    }
    if (userProfile.interests && userProfile.interests.length > 0) {
      profileContext.push(`Interests: ${userProfile.interests.join(', ')}`);
    }
    if (userProfile.weak_spots && userProfile.weak_spots.length > 0) {
      profileContext.push(`Learning focus areas: ${userProfile.weak_spots.join(', ')}`);
    }
    if (profileContext.length > 0) {
      messageContent += `\n\nUSER PROFILE: ${profileContext.join(' | ')}`;
    }
  }

  messageContent += `\n\nGRAPH CONTEXT:\n${contextString}`;

  if (image) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: messageContent },
        { type: 'image_url', image_url: { url: image } }
      ],
    });
  } else {
    messages.push({
      role: 'user',
      content: messageContent,
    });
  }

  return messages;
}

// REMOVED: All classic mode code - unreachable dead code
// Classic mode has been completely removed as GraphRAG is always superior.
// All functionality is now handled by GraphRAG mode with AI-first architecture.

async function handleGraphRAGMode(
  message: string,
  graph_id: string | undefined,
  branch_id: string | undefined,
  lecture_id: string | null | undefined,
  apiKey: string,
  vertical?: 'general' | 'finance',
  lens?: string,
  recency_days?: number,
  evidence_strictness?: 'high' | 'medium' | 'low',
  include_proposed_edges?: boolean,
  responsePrefs?: ResponsePreferences,
  voiceId?: string,
  chatHistory?: ChatHistoryMessage[],
  trail_id?: string,
  focus_concept_id?: string,
  focus_quote_id?: string,
  focus_page_url?: string,
  image?: string,
  ui_context?: ChatRequest['ui_context'],
  forceWebSearch?: boolean
): Promise<NextResponse> {
  const startTime = Date.now();

  // Map parameters to local variables for consistency
  const defaultResponsePrefs: ResponsePreferences = {
    mode: 'compact',
    ask_question_policy: 'at_most_one',
    end_with_next_step: true,
  };
  const finalResponsePrefs = responsePrefs || defaultResponsePrefs;
  const finalVoiceId = voiceId || 'neutral';

  // Declare variables used throughout the function
  // Analysis result variables
  let isGapQuestion = false;
  let retrievalData: any = null;
  let retrievalIntent = 'DEFINITION_OVERVIEW';
  let trace: any[] = [];
  let context: any = {};
  let styleFeedbackResponse: PromiseSettledResult<Response | null> | null = null;
  let styleFeedbackExamples: string = '';
  let userProfile: any = null;
  let webSearchResults: Array<{ title: string; snippet: string; link: string; fullContent?: string; graph?: any }> = [];
  let webSearchContext = '';
  let webSearchAgentAnswer = ''; // New: capture the answer from the research agent
  let extractedGraphData: any = null;

  // Customization and Context variables
  const styleProfile: any = null;
  const feedbackSummary: any = null;
  const focusAreas: any[] = [];

  // Final response variables
  let answer: string = '';
  let wasTruncated: boolean = false;
  let suggestedQuestions: string[] = [];
  let suggestedActions: SuggestedAction[] = [];
  let actionsMatch: RegExpMatchArray | null = null;
  let followUpMatch: RegExpMatchArray | null = null;
  let answerId: string = '';
  const usedNodes: Concept[] = [];
  let duration: number = 0;
  let sections: Array<{ id: string; heading?: string; text: string }> = [];
  let answer_sections: AnswerSection[] = [];
  let recentSummaries: any[] = [];
  let activeTopics: any[] = [];
  let contextText = '';
  let printedClaims: string[] = [];
  let printedQuotes: string[] = [];
  let printedSources: string[] = [];
  try {
    // Default graph_id and branch_id if not provided
    const defaultGraphId = graph_id || 'default';
    const defaultBranchId = branch_id || 'main';

    console.log(`[Chat API] GraphRAG mode: fetching context for graph_id=${defaultGraphId}, branch_id=${defaultBranchId}, vertical=${vertical || 'general'}`);

    // Step 0: Start non-critical metadata fetches early (in parallel with the router)
    const earlyMetadataFetches = [
      fetch(`${API_BASE_URL}/feedback/style/examples?limit=5`).catch(() => null),
      fetch(`${API_BASE_URL}/preferences/learning-topics?limit=10`).catch(() => null),
      fetch(`${API_BASE_URL}/ai/focus-areas`).catch(() => null),
      fetch(`${API_BASE_URL}/preferences/response-style`).catch(() => null),
      fetch(`${API_BASE_URL}/preferences/user-profile`).catch(() => null),
      fetch(`${API_BASE_URL}/preferences/conversation-summaries?limit=5`).catch(() => null),
    ];

    // Step 1: AI-Based Query Routing
    console.log('[Chat API] Using AI query router...');
    const chatHistoryForRouter = chatHistory?.map(h => ({
      role: 'user' as const,
      content: h.question,
    })).slice(-2) || []; // Use fewer messages for router speed

    let routingResult;
    try {
      routingResult = await queryRouterAgent(message, chatHistoryForRouter, apiKey);
      console.log(`[Chat API] Routing: ${routingResult.intent}, complexity: ${routingResult.complexity}`);

      // Override routing result if manual toggle is ON
      if (forceWebSearch) {
        console.log('[Chat API] Manual Web Search toggle is ON. Forcing web search.');
        routingResult.needsWebSearch = true;
      }
    } catch (error) {
      console.error('[Chat API] Router failed:', error);
      routingResult = {
        complexity: 'medium' as const,
        needsRetrieval: true,
        intent: 'question' as const,
        needsWebSearch: !!forceWebSearch,
        searchQuery: '',
        estimatedProcessingTime: 1000,
        requiresSelfKnowledge: false
      };
    }

    // Fast Path for simple queries
    if (routingResult.complexity === 'simple' && !routingResult.needsRetrieval && !routingResult.needsWebSearch) {
      console.log('[Chat API] Fast path triggered');
      const systemPrompt = `You are a helpful AI assistant. Respond brief, friendly, and directly.`;
      const messages = buildMessagesWithHistory(systemPrompt, message, '', chatHistory, '', null, ui_context, image);
      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages, temperature: 0.7, max_tokens: 300 }),
      });
      if (!openaiResponse.ok) throw new Error(`OpenAI error: ${openaiResponse.status}`);
      const openaiData = await openaiResponse.json();
      return NextResponse.json({
        answer: openaiData.choices[0]?.message?.content || "Done!",
        usedNodes: [], suggestedQuestions: [], answerId: null, answer_sections: [],
        meta: { mode: 'graphrag-fast', duration_ms: Date.now() - startTime }
      });
    }

    // Step 2: Parallel Retrieval (GraphRAG + Web Search)
    const retrievalStartTime = Date.now();
    const retrievalTasks: Promise<any>[] = [];

    if (routingResult.needsRetrieval) {
      const retrievalIntent = routingResult.requiresSelfKnowledge ? 'SELF_KNOWLEDGE' : undefined;
      retrievalTasks.push(fetch(`${API_BASE_URL}/ai/retrieve`, {
        method: 'POST',
        headers: getBackendHeaders(),
        body: JSON.stringify({
          message,
          mode: 'graphrag',
          limit: 5,
          graph_id: defaultGraphId,
          branch_id: defaultBranchId,
          trail_id,
          intent: retrievalIntent
        }),
        signal: AbortSignal.timeout(2500)
      }).catch(() => null));
    } else {
      retrievalTasks.push(Promise.resolve(null));
    }

    if (routingResult.needsWebSearch) {
      retrievalTasks.push(performWebSearch(routingResult.searchQuery || message).catch(() => ({ results: [] })));
    } else {
      retrievalTasks.push(Promise.resolve({ results: [] }));
    }

    // Wait for retrieval AND early metadata in parallel
    const [retrievalResultSettled, webSearchResultSettled, ...metadataResultsSettled] = await Promise.allSettled([
      ...retrievalTasks,
      ...earlyMetadataFetches,
    ]);

    // Unpack focus areas (Index 2 in earlyMetadataFetches)
    const focusAreasRes = metadataResultsSettled[2];
    if (focusAreasRes && focusAreasRes.status === 'fulfilled' && focusAreasRes.value?.ok) {
      const areas = await focusAreasRes.value.json().catch(() => []);
      if (Array.isArray(areas)) {
        focusAreas.push(...areas.filter((a: any) => a.active));
      } else {
        console.warn('[Chat API] Focus areas is not an array:', areas);
      }
    }

    // Unpack response style (System Instructions - Index 3 in earlyMetadataFetches)
    const responseStyleRes = metadataResultsSettled[3];
    let customInstructions = '';
    if (responseStyleRes && responseStyleRes.status === 'fulfilled' && responseStyleRes.value?.ok) {
      const styleWrapper = await responseStyleRes.value.json().catch(() => null);
      if (styleWrapper?.profile) {
        const p = styleWrapper.profile;
        customInstructions = `
# SYSTEM INSTRUCTIONS (from user):
Tone: ${p.tone}
Teaching Style: ${p.teaching_style}
Sentence Structure: ${p.sentence_structure}
Explanation Order: ${p.explanation_order && Array.isArray(p.explanation_order) ? p.explanation_order.join(' → ') : ''}
Forbidden Styles: ${p.forbidden_styles && Array.isArray(p.forbidden_styles) ? p.forbidden_styles.join(', ') : ''}
`;
      }
    }

    // Unpack results
    if (retrievalResultSettled.status === 'fulfilled' && retrievalResultSettled.value?.ok) {
      retrievalData = await retrievalResultSettled.value.json().catch(() => null);
      if (retrievalData) {
        retrievalIntent = retrievalData.intent || 'DEFINITION_OVERVIEW';
        trace = retrievalData.trace || [];
        context = retrievalData.context || {};
      }
    }

    if (webSearchResultSettled.status === 'fulfilled' && webSearchResultSettled.value) {
      webSearchResults = webSearchResultSettled.value.results || [];
      webSearchAgentAnswer = webSearchResultSettled.value.answer || '';

      if (webSearchResults.length > 0) {
        webSearchContext = `## Web Search Results\n\n` + webSearchResults.map((r, i) =>
          `${i + 1}. **${r.title}**\n   ${r.fullContent?.substring(0, 500) || r.snippet}\n   [Source: ${r.link}]`
        ).join('\n\n');

        if (webSearchAgentAnswer) {
          webSearchContext = `## Research Agent Preliminary Findings\n${webSearchAgentAnswer}\n\n` + webSearchContext;
        }
      }
    }

    // Unpack metadata using correct indices from earlyMetadataFetches
    styleFeedbackResponse = metadataResultsSettled[0] as any; // Index 0: style examples
    const topicsRes = metadataResultsSettled[1];           // Index 1: learning topics
    // metadataResultsSettled[2] is focusAreas (handled above)
    // metadataResultsSettled[3] is responseStyle (handled above)
    const userProfileRes = metadataResultsSettled[4];      // Index 4: user profile
    const summariesRes = metadataResultsSettled[5];        // Index 5: conversation summaries

    if (userProfileRes?.status === 'fulfilled' && userProfileRes.value?.ok) {
      userProfile = await userProfileRes.value.json().catch(() => null);
    }

    if (summariesRes?.status === 'fulfilled' && summariesRes.value?.ok) {
      const rawSummaries = await summariesRes.value.json().catch(() => []);
      recentSummaries = Array.isArray(rawSummaries) ? rawSummaries : [];
    }

    if (topicsRes?.status === 'fulfilled' && topicsRes.value?.ok) {
      const rawTopics = await topicsRes.value.json().catch(() => []);
      activeTopics = Array.isArray(rawTopics) ? rawTopics : [];
    }

    // Step 3: Context Building (Parallelized within function)
    const contextResult = await buildContextTextFromStructured(context, retrievalIntent, message, apiKey);
    contextText = contextResult.text;
    printedClaims = contextResult.printedClaims;
    printedQuotes = contextResult.printedQuotes;
    printedSources = contextResult.printedSources;

    const retrievalLatency = Date.now() - retrievalStartTime;
    console.log(`[Chat API] Retrieval + Metadata completed in ${retrievalLatency}ms`);

    // Process style feedback
    if (styleFeedbackResponse && styleFeedbackResponse.status === 'fulfilled' && styleFeedbackResponse.value?.ok) {
      const styleFeedbacks = await styleFeedbackResponse.value.json().catch(() => []);
      if (Array.isArray(styleFeedbacks)) {
        styleFeedbackExamples = styleFeedbacks.map((fb: any, idx: number) => {
          const original = (fb.original_response || '').substring(0, 150);
          const feedback = (fb.feedback_notes || '').substring(0, 150);
          return `${idx + 1}. ORIGINAL: ${original}...\n   FEEDBACK: ${feedback}...`;
        }).join('\n\n');
      }
    }

    // Build combined context text
    let combinedContextText = '';
    if (webSearchContext) combinedContextText += webSearchContext;
    if (contextText) combinedContextText += (combinedContextText ? '\n\n' : '') + contextText;

    // Add long-term context
    let longTermContext = '';
    if (recentSummaries?.length > 0) {
      longTermContext += `## Recent Conversation\n` + recentSummaries.slice(0, 3).map((s: any) => `Q: ${s.question}`).join('\n') + '\n\n';
    }
    if (activeTopics?.length > 0) {
      longTermContext += `## Active Topics\nYou've been learning about: ` + activeTopics.slice(0, 5).map((t: any) => t.name).join(', ') + '\n\n';
    }
    if (focusAreas.length > 0) {
      longTermContext += `## Learning Focus\nYou are currently focusing on: ` + focusAreas.map((f: any) => f.name).join(', ') + '\n\n';
    }
    combinedContextText = longTermContext + combinedContextText;

    // Step 4: Final Response Generation
    const contextNote = combinedContextText.trim().length === 0 ? "\n\nNOTE: No GraphRAG context found. Use general knowledge." : "";
    const baseSystemPromptGraphrag = `You are Brain Web, a teaching assistant. Use context to answer. Cite [Quote: ID], [Claim: ID], or [Source: URL] ONLY if context is available. No bold for concepts.`;

    const additionalLayers: string[] = [];
    if (userProfile) additionalLayers.push(`## User Identity & Background\n${JSON.stringify(userProfile, null, 2)}`);
    if (customInstructions) additionalLayers.push(customInstructions);
    if (styleFeedbackExamples) additionalLayers.push(`## Style Feedback (Learned Patterns):\n${styleFeedbackExamples}`);
    if (webSearchAgentAnswer) additionalLayers.push(`## External Research synthesis:\n${webSearchAgentAnswer}`);

    const { systemPrompt, maxTokens } = buildPrompt(
      baseSystemPromptGraphrag,
      finalResponsePrefs,
      finalVoiceId,
      userProfile,
      additionalLayers
    );
    const messages = buildMessagesWithHistory(systemPrompt, message, combinedContextText + contextNote, chatHistory, '', userProfile, ui_context, image);

    console.log('[Chat API] Fetching answer...');
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages, temperature: 0.7, max_tokens: maxTokens }),
    });

    if (!openaiRes.ok) throw new Error(`OpenAI error: ${openaiRes.status}`);
    const openaiData = await openaiRes.json();
    const responseText = openaiData.choices[0]?.message?.content || '';

    answer = responseText.split('SUGGESTED_ACTIONS:')[0].split('FOLLOW_UP_QUESTIONS:')[0].trim();

    // Parse actions and follow-ups
    const actionsMatch = responseText.match(/SUGGESTED_ACTIONS:\s*(\[[\s\S]*?\])/);
    if (actionsMatch) try { suggestedActions = JSON.parse(actionsMatch[1]); } catch (e) { }
    const followUpMatch = responseText.match(/FOLLOW_UP_QUESTIONS:\s*(\[[\s\S]*?\])/);
    if (followUpMatch) try { suggestedQuestions = JSON.parse(followUpMatch[1]); } catch (e) { }

    answerId = `answer-${Date.now()}`;
    answer_sections = mapEvidenceToSections(splitAnswerIntoSections(answer), []);

    // Background storage and profile update
    const storagePromise = fetch(`${API_BASE_URL}/answers/store`, {
      method: 'POST',
      headers: getBackendHeaders(),
      body: JSON.stringify({ answer_id: answerId, question: message, raw_answer: answer, used_node_ids: usedNodes.map(n => n.node_id) }),
    }).catch(() => null);

    // Profile Update - Background extraction of personal details
    const profileUpdatePromise = profileUpdateAgent(message, chatHistoryForRouter, userProfile, apiKey)
      .then(async (result) => {
        if (result.confidence > 0.6 && Object.keys(result.updates).length > 0) {
          console.log('[Chat API] Profile updates detected:', result.updates);
          await fetch(`${API_BASE_URL}/preferences/user-profile`, {
            method: 'PATCH', // Changed from POST for partial updates
            headers: getBackendHeaders(),
            body: JSON.stringify(result.updates),
          }).catch(() => null);
        }
      })
      .catch(() => null);

    // Group non-critical background tasks
    Promise.all([storagePromise, profileUpdatePromise]).catch(() => null);

    // Background summary/topics extraction
    (async () => {
      try {
        const extractionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'system', content: 'Extract topics and summary. Return JSON: { "topics": [], "summary": "" }' }, { role: 'user', content: `Q: ${message}\nA: ${answer}` }],
            response_format: { type: 'json_object' }
          }),
        });
        if (extractionResponse.ok) {
          const { topics, summary } = await extractionResponse.json().then(d => JSON.parse(d.choices[0].message.content));
          await fetch(`${API_BASE_URL}/preferences/conversation-summaries`, {
            method: 'POST', headers: getBackendHeaders(),
            body: JSON.stringify({ timestamp: Math.floor(Date.now() / 1000), question: message, answer: answer.substring(0, 500), topics, summary })
          });
        }
      } catch (e) { }
    })();

    duration = Date.now() - startTime;
    return NextResponse.json({
      answer, usedNodes, suggestedQuestions: suggestedQuestions.slice(0, 3),
      suggestedActions: suggestedActions.slice(0, 5), answerId, answer_sections,
      graph_data: extractedGraphData, webSearchResults,
      meta: { mode: 'graphrag', duration_ms: duration, intent: retrievalIntent, traceSteps: trace.length, rewriteApplied: false }
    });
  } catch (error) {
    console.error('GraphRAG error:', error);
    return NextResponse.json({ error: String(error), answer: "I encountered an error. Please try again." }, { status: 500 });
  }
}

/**
 * Split answer text into 3-7 sections for inline claim alignment.
 * Uses paragraph breaks as natural section boundaries.
 */
function splitAnswerIntoSections(answer: string): Array<{ id: string; heading?: string; text: string }> {
  // Split by double newlines (paragraph breaks)
  const paragraphs = answer.split(/\n\n+/).filter(p => p.trim().length > 0);

  if (paragraphs.length === 0) {
    return [{ id: 'section-0', text: answer }];
  }

  // Target 3-7 sections
  const targetSections = Math.min(Math.max(3, Math.ceil(paragraphs.length / 2)), 7);

  // If we have fewer paragraphs than target, use one paragraph per section
  if (paragraphs.length <= targetSections) {
    return paragraphs.map((p, idx) => ({
      id: `section-${idx}`,
      text: p.trim(),
    }));
  }

  // Otherwise, merge paragraphs to reach target count
  const sections: Array<{ id: string; heading?: string; text: string }> = [];
  const paragraphsPerSection = Math.ceil(paragraphs.length / targetSections);

  for (let i = 0; i < paragraphs.length; i += paragraphsPerSection) {
    const sectionParagraphs = paragraphs.slice(i, i + paragraphsPerSection);
    const sectionText = sectionParagraphs.join('\n\n').trim();

    // Try to extract a heading from first line if it looks like one (short, ends with colon, or is a question)
    let heading: string | undefined;
    const firstLine = sectionText.split('\n')[0];
    if (firstLine.length < 60 && (firstLine.endsWith(':') || firstLine.endsWith('?'))) {
      heading = firstLine;
    }

    sections.push({
      id: `section-${sections.length}`,
      heading,
      text: sectionText,
    });
  }

  return sections;
}

/**
 * Map evidence items to answer sections using heuristic keyword matching.
 * Returns sections with supporting_evidence_ids populated.
 */
function mapEvidenceToSections(
  sections: Array<{ id: string; heading?: string; text: string }>,
  evidenceItems: EvidenceItem[]
): AnswerSection[] {
  if (evidenceItems.length === 0) {
    return sections.map(s => ({
      ...s,
      supporting_evidence_ids: [],
    }));
  }

  // Build keyword index from evidence titles and snippets
  const evidenceKeywords: Map<number, Set<string>> = new Map();
  evidenceItems.forEach((item, idx) => {
    const keywords = new Set<string>();
    if (item.title) {
      item.title.toLowerCase().split(/\s+/).forEach(w => {
        if (w.length > 3) keywords.add(w);
      });
    }
    if (item.snippet) {
      item.snippet.toLowerCase().split(/\s+/).forEach(w => {
        if (w.length > 3) keywords.add(w);
      });
    }
    evidenceKeywords.set(idx, keywords);
  });

  // Map sections to evidence
  return sections.map(section => {
    const sectionTextLower = section.text.toLowerCase();
    const sectionWords = new Set(sectionTextLower.split(/\s+/).filter(w => w.length > 3));

    // Score each evidence item by keyword overlap
    const scores: Array<{ idx: number; score: number }> = [];
    evidenceItems.forEach((item, idx) => {
      const keywords = evidenceKeywords.get(idx) || new Set();
      let score = 0;
      sectionWords.forEach(word => {
        if (keywords.has(word)) score += 1;
      });
      // Bonus if evidence title appears in section text
      if (item.title && sectionTextLower.includes(item.title.toLowerCase())) {
        score += 5;
      }
      if (score > 0) {
        scores.push({ idx, score });
      }
    });

    // Sort by score and take top 2-3
    scores.sort((a, b) => b.score - a.score);
    const topEvidenceIndices = scores.slice(0, 3).map(s => s.idx);

    // If no keyword match, fallback: distribute evidence evenly across sections
    if (topEvidenceIndices.length === 0 && evidenceItems.length > 0) {
      const sectionIdx = sections.indexOf(section);
      const evidencePerSection = Math.ceil(evidenceItems.length / sections.length);
      const startIdx = sectionIdx * evidencePerSection;
      const endIdx = Math.min(startIdx + evidencePerSection, evidenceItems.length);
      for (let i = startIdx; i < endIdx && i < startIdx + 3; i++) {
        topEvidenceIndices.push(i);
      }
    }

    // Get evidence IDs (prefer resource_id, fallback to id or index-based)
    const supporting_evidence_ids = topEvidenceIndices
      .map(idx => {
        const item = evidenceItems[idx];
        return item.resource_id || item.id || `evidence-${idx}`;
      })
      .filter((id, idx, arr) => arr.indexOf(id) === idx); // dedupe

    return {
      ...section,
      supporting_evidence_ids,
    };
  });
}

/**
 * Parse citation tokens from answer text.
 * Returns arrays of claim IDs, quote IDs, and source URLs.
 */
function parseCitationTokens(answerText: string): {
  claims: string[];
  quotes: string[];
  sources: string[];
} {
  const claims: string[] = [];
  const quotes: string[] = [];
  const sources: string[] = [];

  // Match [Claim: ...]
  const claimPattern = /\[Claim:\s*([^\]]+)\]/g;
  let match;
  while ((match = claimPattern.exec(answerText)) !== null) {
    claims.push(match[1].trim());
  }

  // Match [Quote: ...]
  const quotePattern = /\[Quote:\s*([^\]]+)\]/g;
  while ((match = quotePattern.exec(answerText)) !== null) {
    quotes.push(match[1].trim());
  }

  // Match [Source: ...]
  const sourcePattern = /\[Source:\s*([^\]]+)\]/g;
  while ((match = sourcePattern.exec(answerText)) !== null) {
    sources.push(match[1].trim());
  }

  return { claims, quotes, sources };
}

/**
 * Verify citation tokens against allowlists.
 * Returns verification result with invalid tokens if any.
 */
function verifyCitationTokens(
  tokens: { claims: string[]; quotes: string[]; sources: string[] },
  allowlists: { claims: string[]; quotes: string[]; sources: string[] }
): { ok: boolean; invalid: { claims: string[]; quotes: string[]; sources: string[] } } {
  const invalid = {
    claims: tokens.claims.filter(id => !allowlists.claims.includes(id)),
    quotes: tokens.quotes.filter(id => !allowlists.quotes.includes(id)),
    sources: tokens.sources.filter(url => !allowlists.sources.includes(url)),
  };

  const ok = invalid.claims.length === 0 && invalid.quotes.length === 0 && invalid.sources.length === 0;

  return { ok, invalid };
}

/**
 * @deprecated Use AI Validator agent instead. This rule-based validation is replaced by AI agents.
 * Check strictness validation for high mode.
 * Returns true if answer meets citation requirements.
 */
function checkStrictnessValidation(answerText: string): { passes: boolean; reason?: string } {
  const sentences = answerText.split(/[.!?]+/).filter(s => s.trim().length > 10);

  if (sentences.length === 0) {
    return { passes: true };
  }

  const citationPattern = /\[(Claim|Quote|Source):\s*[^\]]+\]/g;
  let sentencesWithCitations = 0;
  let sentencesRequiringCitations = 0;
  const sentencesMissingCitations: string[] = [];

  for (const sentence of sentences) {
    const hasCitation = citationPattern.test(sentence);
    if (hasCitation) {
      sentencesWithCitations++;
    }

    // Check if sentence requires citation (has number, date-like pattern, or proper noun)
    const hasNumber = /\d/.test(sentence);
    const hasDateLike = /\b(January|February|March|April|May|June|July|August|September|October|November|December|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4})\b/i.test(sentence);
    const hasProperNoun = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/.test(sentence.substring(1)); // Capital word not at start

    if (hasNumber || hasDateLike || hasProperNoun) {
      sentencesRequiringCitations++;
      if (!hasCitation) {
        sentencesMissingCitations.push(sentence.substring(0, 50) + '...');
      }
    }
  }

  // Require at least 1 out of every 2 sentences has citation, OR
  // All sentences requiring citations must have citations
  const citationRatio = sentencesWithCitations / sentences.length;
  const requiresCitationsRatio = sentencesRequiringCitations > 0
    ? (sentencesRequiringCitations - sentencesMissingCitations.length) / sentencesRequiringCitations
    : 1;

  if (citationRatio < 0.5 && requiresCitationsRatio < 1.0) {
    return {
      passes: false,
      reason: `Only ${sentencesWithCitations}/${sentences.length} sentences have citations, and ${sentencesMissingCitations.length} sentences requiring citations are missing them.`,
    };
  }

  return { passes: true };
}

/**
 * Build context text from structured context payload.
 * Phase C: Prepend session context and quotes/claims with IDs.
 * Returns context text and printed evidence IDs for allowlist.
 */
async function buildContextTextFromStructured(
  context: any,
  retrievalIntent: string,
  question: string,
  apiKey: string
): Promise<{
  text: string;
  printedClaims: string[];
  printedQuotes: string[];
  printedSources: string[];
}> {
  const parts: string[] = [];
  const printedClaims: string[] = [];
  const printedQuotes: string[] = [];
  const printedSources: string[] = [];

  // Phase A: Identify all chunks to optimize
  const optimizationPromises: Record<string, Promise<any>> = {};

  if (context.focus_context?.quotes || context.quotes) {
    const allQuotes = [...(context.focus_context?.quotes || []), ...(context.quotes || [])];
    const chunks = allQuotes.map((q: any) => ({ content: q.text || '', type: 'quote' as const, id: q.quote_id }));
    optimizationPromises.quotes = buildOptimizedContext(chunks, question, 4000, apiKey);
  }

  if (context.focus_communities) {
    const chunks = context.focus_communities.map((c: any) => ({ content: c.name || '', type: 'community' as const, id: c.community_id }));
    optimizationPromises.communities = buildOptimizedContext(chunks, question, 1000, apiKey);
  }

  if (context.focus_entities) {
    const chunks = context.focus_entities.map((c: any) => ({ content: c.name + ': ' + (c.description || ''), type: 'concept' as const, id: c.node_id }));
    optimizationPromises.concepts = buildOptimizedContext(chunks, question, 2000, apiKey);
  }

  // Await all in parallel
  const optimized = await Promise.all(Object.entries(optimizationPromises).map(async ([key, p]) => [key, await p]));
  const results: any = Object.fromEntries(optimized);

  // Phase B: Build text parts
  if (context.session_context) {
    parts.push(`## Session Context\nTrail: ${context.session_context.summary || 'Active session'}\n`);
  }

  if (results.quotes) {
    parts.push("## Supporting Quotes");
    results.quotes.selectedChunks.forEach((chunk: any) => {
      const q = [...(context.focus_context?.quotes || []), ...(context.quotes || [])].find((item: any) => item.quote_id === chunk.id);
      if (q) {
        parts.push(`Quote: "${q.text}" [Quote: ${q.quote_id}]`);
        printedQuotes.push(q.quote_id);
        if (q.source_url) printedSources.push(q.source_url);
      }
    });
  }

  if (context.claims) {
    parts.push("## Supporting Claims");
    context.claims.slice(0, 10).forEach((c: any) => {
      parts.push(`Claim: ${c.text} [Claim: ${c.claim_id}]`);
      printedClaims.push(c.claim_id);
    });
  }

  if (results.communities) {
    parts.push("## Community Context");
    results.communities.selectedChunks.forEach((chunk: any) => {
      const c = context.focus_communities.find((item: any) => item.community_id === chunk.id);
      if (c) parts.push(`### ${c.name}`);
    });
  }

  return {
    text: parts.join("\n\n"),
    printedClaims, printedQuotes, printedSources
  };
}

/**
 * Helper function to select top claims using AI-based importance scoring
 */
async function _selectTopClaims(
  claims: any[],
  question: string,
  apiKey: string,
  maxClaims: number = 5
): Promise<any[]> {
  if (!claims || claims.length === 0) return [];
  if (claims.length <= maxClaims) return claims;

  try {
    const claimChunks: ContextChunk[] = claims.map((claim: any) => ({
      content: claim.text || '',
      type: 'claim' as const,
      id: claim.claim_id,
    }));

    const optimized = await buildOptimizedContext(claimChunks, question, 2000, apiKey);
    return optimized.selectedChunks
      .map(chunk => claims.find((c: any) => c.claim_id === chunk.id))
      .filter((c): c is any => c !== undefined)
      .slice(0, maxClaims);
  } catch (error) {
    console.error('[Chat API] Error selecting top claims, using first N:', error);
    return claims.slice(0, maxClaims); // Fallback to simple slicing
  }
}
