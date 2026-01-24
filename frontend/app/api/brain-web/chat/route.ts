import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { 
  queryRouterAgent, 
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

/**
 * Detect if a question needs current/real-time information
 */
async function needsWebSearch(question: string, apiKey: string): Promise<boolean> {
  const detectionPrompt = `Determine if this question requires current/real-time information from the internet.

Questions that NEED web search:
- Current events, recent news, latest updates
- Current CEO/leadership of companies
- Recent stock prices, market data
- Current weather, today's events
- Recent product releases, announcements
- Questions with words like "current", "latest", "now", "today", "recent"

Questions that DON'T need web search:
- Historical facts, definitions, concepts
- General knowledge that doesn't change
- Questions about established facts

Question: "${question}"

Return ONLY a JSON object:
{
  "needs_web_search": true/false,
  "reason": "brief explanation"
}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a question analyzer. Return only valid JSON.' },
          { role: 'user', content: detectionPrompt }
        ],
        temperature: 0.2,
        max_tokens: 100,
        response_format: { type: 'json_object' },
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const result = JSON.parse(data.choices[0].message.content);
      return result.needs_web_search === true;
    }
  } catch (err) {
    console.warn('[Chat API] Web search detection failed:', err);
  }
  
  // Fallback: simple heuristic
  const currentInfoKeywords = /\b(current|latest|now|today|recent|ceo|president|stock|price|weather)\b/i;
  return currentInfoKeywords.test(question);
}


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
async function performWebSearch(query: string): Promise<{ 
  results: Array<{ 
    title: string; 
    snippet: string; 
    link: string; 
    fullContent?: string;  // Full scraped content when available
  }>; 
  error?: string; 
}> {
  // Use Brain Web's native web search API (backend)
  const backendUrl = API_BASE_URL;
  const numResults = 3; // Fetch full content from top 3 results
  
  // Use /web-search/search-and-fetch endpoint (native Brain Web)
  const searchAndFetchController = new AbortController();
  const searchAndFetchTimeout = setTimeout(() => searchAndFetchController.abort(), 30000); // 30s timeout
  
  try {
    const searchAndFetchResponse = await fetch(
      `${backendUrl}/web-search/search-and-fetch?query=${encodeURIComponent(query)}&num_results=${numResults}&max_content_length=10000`,
      { 
        signal: searchAndFetchController.signal,
        headers: getBackendHeaders(),
      }
    );
    clearTimeout(searchAndFetchTimeout);
    
    if (searchAndFetchResponse.ok) {
      const data = await searchAndFetchResponse.json();
      const results: Array<{ title: string; snippet: string; link: string; fullContent?: string }> = [];
      
      if (data.results && Array.isArray(data.results)) {
        for (const item of data.results) {
          if (item.search_result && item.fetched_content) {
            // We have full fetched content
            results.push({
              title: item.search_result.title || item.fetched_content.title || '',
              snippet: item.search_result.snippet || item.fetched_content.content?.substring(0, 200) || '',
              link: item.search_result.url || '',
              fullContent: item.fetched_content.content || '',
            });
          } else if (item.search_result) {
            // Search result but no fetched content
            results.push({
              title: item.search_result.title || '',
              snippet: item.search_result.snippet || '',
              link: item.search_result.url || '',
            });
          }
        }
      }
      
      if (results.length > 0) {
        const withContent = results.filter(r => r.fullContent).length;
        console.log(`[Chat API] Brain Web Web Search: Found ${results.length} results, ${withContent} with full content`);
        return { results };
      }
    }
  } catch (err: any) {
    clearTimeout(searchAndFetchTimeout);
    if (err.name !== 'AbortError') {
      console.warn('[Chat API] Web search-and-fetch failed, trying search-only:', err);
    }
  }
  
  // Fallback to search-only endpoint
  const searchController = new AbortController();
  const searchTimeout = setTimeout(() => searchController.abort(), 15000);
  
  try {
    const searchResponse = await fetch(
      `${backendUrl}/web-search/search?query=${encodeURIComponent(query)}`,
      { 
        signal: searchController.signal,
        headers: getBackendHeaders(),
      }
    );
    clearTimeout(searchTimeout);
    
    if (searchResponse.ok) {
      const data = await searchResponse.json();
      const results = (data.results || []).slice(0, 5).map((item: any) => ({
        title: item.title || '',
        snippet: item.snippet || '',
        link: item.url || '',
      }));
      
      if (results.length > 0) {
        console.log(`[Chat API] Brain Web Web Search (search-only): Found ${results.length} results`);
        return { results };
      }
    }
  } catch (err: any) {
    clearTimeout(searchTimeout);
    if (err.name !== 'AbortError') {
      console.error('[Chat API] Web search failed:', err);
    }
  }

  // If all fail, return error
  return { 
    results: [], 
    error: 'Web search failed. Make sure SearXNG is running on localhost:8888 and the backend is running.' 
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
  mode?: 'classic' | 'graphrag';
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
  ui_context?: {
    dom_path?: string;
    position?: { top: number; left: number; width: number; height: number };
    react_component?: string;
    html_element?: string;
  };
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
  };
  evidenceUsed?: EvidenceItem[];
  answer_sections?: AnswerSection[];
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
  additionalLayers?: string[]
): { systemPrompt: string; maxTokens: number } {
  const prefs = {
    mode: responsePrefs.mode || 'compact',
    max_output_tokens: responsePrefs.max_output_tokens,
    ask_question_policy: responsePrefs.ask_question_policy || 'at_most_one',
    end_with_next_step: responsePrefs.end_with_next_step !== false,
  };

  // Stable system contract (behavior rules)
  const contract = `
RESPONSE CONTRACT (MUST FOLLOW):
- Default mode: ${prefs.mode === 'compact' ? 'succinct, conversational, one step at a time' : prefs.mode === 'hint' ? 'brief nudge only' : prefs.mode === 'deep' ? 'structured with clear sections' : 'balanced explanation'}
- Ask at most ${prefs.ask_question_policy === 'never' ? 'zero' : prefs.ask_question_policy === 'at_most_one' ? 'one' : 'questions as needed'} question${prefs.ask_question_policy === 'at_most_one' ? '' : 's'} unless blocked
- ${prefs.end_with_next_step ? 'Always end with a micro-next-step or fork ("Want the hint or the full solution?")' : 'End naturally'}
`;

  // Voice card (tone/pacing only, not behavior)
  const voiceCards: Record<string, string> = {
    neutral: 'Tone: Professional and clear. Pacing: Steady.',
    friendly: 'Tone: Warm and approachable. Pacing: Conversational.',
    direct: 'Tone: Straightforward and no-nonsense. Pacing: Quick.',
    playful: 'Tone: Light and engaging. Pacing: Varied with energy.',
  };
  const voiceCard = voiceCards[voiceId] || voiceCards.neutral;

  // Mode adapter instructions
  const modeInstructions: Record<string, string> = {
    compact: `OUTPUT FORMAT: 1-2 lines maximum. Be extremely concise. No multi-step plans unless explicitly requested.`,
    hint: `OUTPUT FORMAT: One brief nudge (1-2 sentences). No explanations, no plans, just a hint.`,
    normal: `OUTPUT FORMAT: Balanced explanation (2-4 paragraphs). Can include structure if helpful.`,
    deep: `OUTPUT FORMAT: Structured response with clear sections. Can include action plans (3-5 bullets) and detailed explanations.`,
  };
  const modeInstruction = modeInstructions[prefs.mode] || modeInstructions.normal;

  // User Preferred Style Guide (high priority - based on detailed feedback)
  const userStyleGuide = `
USER PREFERRED STYLE (CRITICAL - FOLLOW STRICTLY):
- Be direct and conversational. Just state things, don't introduce them formally.
- NO unnecessary transitions: Avoid "Now, zooming out,", "Let's take a step back", "At a broader level,", "At its core," unless truly necessary.
- NO formal section headers: Never use **Big Picture:**, **Core Concept Definition:**, or stars/bold for sections.
- NO bold formatting for concepts/nodes: When mentioning concepts or nodes from the graph, mention them naturally without using **bold** markdown. They should be implicitly referenced, not highlighted with formatting.
- Integrate analogies naturally: Weave them into the flow, don't break paragraphs unnecessarily.
- One expanded example > multiple examples: Pick one concrete example and expand it, don't list many.
- Explain technical terms simply or avoid: If you use a term, explain what it means. Avoid ambiguous terms like "handle their own state" or "virtual DOM" without context.
- Keep it concise: Cut unnecessary words and qualifiers like "known as", "falls under the category of", "in the same arena as".
- Don't introduce unrelated concepts: Only mention other tools/concepts if truly required in the conversation.
- Flow naturally: No formal transitions needed, just move to the next idea.
- Use concrete, visualizable terms: "toolkit", "building blocks" - make concepts tangible.

Examples of good style:
- "Think of React as a toolkit for building user interfaces" (good opening)
- "React is a JavaScript library that helps you build user interfaces" (direct)
- "Backend is code. Frontend is view. Use React to build your UI." (clear, simple)

Examples of bad style:
- "Let's take a step back and look at React from a broader perspective" (unnecessary transition)
- "**Big Picture:** React is..." (formal header)
- "Now, zooming out, React is part of..." (unnecessary transition)
- "At its core, React emphasizes the 'view'" (unclear, ambiguous)
`;

  // Compose final prompt
  let systemPrompt = basePrompt + '\n\n' + contract + '\n' + voiceCard + '\n' + modeInstruction + '\n' + userStyleGuide;
  
  // Add additional layers if provided
  if (additionalLayers) {
    additionalLayers.forEach(layer => {
      systemPrompt += '\n' + layer;
    });
  }
  
  // Add style feedback examples if provided (for learning)
  if (additionalLayers && additionalLayers.some(l => l.includes('STYLE FEEDBACK'))) {
    // Style feedback already included in additionalLayers
  }

  // Determine max tokens based on mode
  // Increased limits to prevent truncation - especially for explanatory questions
  const maxTokens = prefs.max_output_tokens || (
    prefs.mode === 'compact' ? 800 : // Increased from 150 to allow complete explanations
    prefs.mode === 'hint' ? 100 :
    prefs.mode === 'deep' ? 2000 :
    2000 // normal - increased to prevent response cropping
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

export async function POST(request: NextRequest) {
  try {
    // Get API key at request time (not module load time) to ensure fresh value
    const apiKey = getOpenAIApiKey();
    
    const body: ChatRequest = await request.json();
    // Always use GraphRAG - it's superior to classic mode in all cases
    // Mode parameter is deprecated but kept for backward compatibility
    const { message: initialMessage, mode = 'graphrag', graph_id, branch_id, lecture_id, vertical: initialVertical, lens: initialLens, recency_days, evidence_strictness, include_proposed_edges, response_prefs, voice_id, chatHistory, trail_id, focus_concept_id, focus_quote_id, focus_page_url, ui_context } = body;
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

    // Always use GraphRAG mode - it's superior in all cases
    // Classic mode has been removed as GraphRAG provides better context and evidence
    const result = await handleGraphRAGMode(message, graph_id, branch_id, lecture_id, apiKey, vertical, lens, recency_days, evidence_strictness, include_proposed_edges, finalResponsePrefs, finalVoiceId, chatHistory, trail_id, focus_concept_id, focus_quote_id, focus_page_url, ui_context);
    const totalDuration = Date.now() - startTime;
    console.log(`[Chat API] GraphRAG mode completed in ${totalDuration}ms`);
    return result; // handleGraphRAGMode already includes metrics
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
  uiContext?: ChatRequest['ui_context']
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
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

  messages.push({
    role: 'user',
    content: messageContent,
  });

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
  ui_context?: ChatRequest['ui_context']
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
  let isGapQuestion = false;
  let styleFeedbackExamples: string = '';
  const teachingStyleProfile: any = null;
  const styleProfile: any = null;
  const feedbackSummary: any = null;
  const focusAreas: any[] = [];
  let userProfile: any = null;
  let webSearchResults: Array<{ title: string; snippet: string; link: string; fullContent?: string }> = [];
  let webSearchContext = '';
  try {
    // Default graph_id and branch_id if not provided
    const defaultGraphId = graph_id || 'default';
    const defaultBranchId = branch_id || 'main';

    console.log(`[Chat API] GraphRAG mode: fetching context for graph_id=${defaultGraphId}, branch_id=${defaultBranchId}, vertical=${vertical || 'general'}`);

    // Step 1: AI-Based Query Routing (replaces all rule-based pattern matching)
    console.log('[Chat API] Using AI query router to determine complexity and intent...');
    const chatHistoryForRouter = chatHistory?.map(h => ({
      role: 'user' as const,
      content: h.question,
    })).slice(-3) || [];
    
    let routingResult;
    try {
      routingResult = await queryRouterAgent(message, chatHistoryForRouter, apiKey);
      console.log(`[Chat API] Query router result:`, routingResult);
    } catch (error) {
      console.error('[Chat API] Query router failed, using fallback:', error);
      // Fallback: assume medium complexity
      routingResult = {
        complexity: 'medium' as const,
        needsRetrieval: true,
        intent: 'question',
        estimatedProcessingTime: 1000,
      };
    }
    
    // Step 1.5: Check if question needs web search for current information
    try {
      const needsSearch = await needsWebSearch(message, apiKey);
      if (needsSearch) {
        console.log('[Chat API] Question needs current information, performing web search...');
        const searchQuery = message; // Use the question as search query
        const searchResult = await performWebSearch(searchQuery);
        if (searchResult.results && searchResult.results.length > 0) {
          webSearchResults = searchResult.results;
          webSearchContext = `## Current Information from Web Search\n\n`;
          webSearchResults.forEach((result, idx) => {
            webSearchContext += `${idx + 1}. **${result.title}**\n`;
            if (result.fullContent) {
              // Include full scraped content (truncated if too long)
              const content = result.fullContent.length > 2000 
                ? result.fullContent.substring(0, 2000) + '...' 
                : result.fullContent;
              webSearchContext += `   Full Content: ${content}\n`;
            } else {
              // Fallback to snippet if full content not available
              webSearchContext += `   ${result.snippet}\n`;
            }
            webSearchContext += `   Source: ${result.link}\n\n`;
          });
          const withFullContent = webSearchResults.filter(r => r.fullContent).length;
          console.log(`[Chat API] ✓ Found ${webSearchResults.length} web search results (${withFullContent} with full content)`);
        } else if (searchResult.error) {
          console.warn(`[Chat API] Web search failed: ${searchResult.error}`);
          // Continue without web search - don't fail the request
        }
      }
    } catch (err) {
      console.warn('[Chat API] Web search error:', err);
      // Continue without web search - don't fail the request
    }
    
    // For simple queries, skip all the heavy processing and respond quickly
    if (routingResult.complexity === 'simple' && !routingResult.needsRetrieval) {
      console.log('[Chat API] Simple conversational query detected, using fast path (skipping retrieval, task detection, itinerary detection)');
      
      // Build a simple prompt for conversational queries
      const systemPrompt = `You are a helpful AI assistant. Respond naturally and conversationally to the user's question. Keep responses brief and friendly.
      
CONVERSATIONAL CONTEXT:
- Maintain context from conversation history when relevant
- When the user asks "How does this relate to...", "What about...", or uses pronouns like "this", "that", "it" - identify what they're referring to from previous messages
- Connect follow-up questions to topics discussed earlier ONLY when the connection is clear and relevant
- Don't force connections to previous topics if the current question is unrelated

ANSWER GENERAL KNOWLEDGE QUESTIONS DIRECTLY:
- When asked about general knowledge (companies, people, historical events, etc.), answer directly using your training data
- Be SPECIFIC and FACTUAL: mention actual names, dates, events, and concrete details
- DO NOT say "I don't have information" just to be cautious - use your general knowledge
- Only admit uncertainty if you genuinely don't know the answer`;
      
      // Build conversation summary for context
      const conversationSummary = chatHistory ? buildConversationSummary(chatHistory) : '';
      
      const messages = buildMessagesWithHistory(systemPrompt, message, '', chatHistory, conversationSummary, userProfile, ui_context);
      
      // Call OpenAI directly without retrieval
      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages,
          temperature: 0.7,
          max_tokens: 300, // Shorter responses for simple queries
        }),
      });

      if (!openaiResponse.ok) {
        const errorText = await openaiResponse.text();
        throw new Error(`OpenAI API error: ${openaiResponse.status} ${errorText}`);
      }

      const openaiData = await openaiResponse.json();
      const answer = openaiData.choices[0]?.message?.content || "I'm here to help!";
      
      const totalDuration = Date.now() - startTime;
      console.log(`[Chat API] Simple query completed in ${totalDuration}ms (fast path via AI router)`);
      
      return NextResponse.json({
        answer,
        usedNodes: [],
        suggestedQuestions: [],
        answerId: null,
        answer_sections: [],
        ...(process.env.NODE_ENV === 'development' && {
          meta: {
            mode: 'graphrag-fast',
            duration_ms: totalDuration,
            skipped_retrieval: true,
            router_intent: routingResult.intent,
            router_complexity: routingResult.complexity,
          }
        }),
      });
    }
    
    // Step 2: Handle special intents detected by router (task creation, itinerary)
    // Extract intent-specific data if needed
    const routerIntent = routingResult.intent;
    let isTaskCreationQuery = false;
    let taskExtractionResult: any = null;
    let isItineraryQuery = false;
    let itineraryDateInfo: { target_date: string | null; is_tomorrow: boolean; is_today: boolean } | null = null;
    
    // If router detected task_creation or itinerary intent, extract details
    if (routerIntent === 'task_creation') {
      console.log('[Chat API] Task creation intent detected by router, extracting task details...');
      try {
        const taskExtractionPrompt = `Extract task details from this message.

User message: "${message}"

Return ONLY a JSON object:
{
  "task_data": {
    "title": "short descriptive title" or null,
    "estimated_minutes": number or null,
    "priority": "high|medium|low" or null,
    "energy": "high|med|low" or null,
    "due_date": "YYYY-MM-DD" or null,
    "preferred_time_windows": ["morning"|"afternoon"|"evening"] or null,
    "notes": "additional context" or null
  }
}`;

        const taskResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are a task extraction expert. Return only valid JSON.' },
              { role: 'user', content: taskExtractionPrompt }
            ],
            temperature: 0.2,
            max_tokens: 300,
            response_format: { type: 'json_object' },
          }),
        });

        if (taskResponse.ok) {
          const taskData = await taskResponse.json();
          const parsed = JSON.parse(taskData.choices[0].message.content);
          taskExtractionResult = parsed.task_data;
          isTaskCreationQuery = true;
          console.log('[Chat API] Task extraction successful:', taskExtractionResult);
        }
      } catch (err) {
        console.error('[Chat API] Task extraction failed:', err);
      }
    }
    
    if (routerIntent === 'itinerary') {
      console.log('[Chat API] Itinerary intent detected by router, extracting date info...');
      try {
        const dateExtractionPrompt = `Extract date information from this itinerary query.

User message: "${message}"

Return ONLY a JSON object:
{
  "date_info": {
    "target_date": "YYYY-MM-DD" or null,
    "is_tomorrow": true/false,
    "is_today": true/false,
    "is_specific_date": true/false
  }
}`;

        const dateResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are a date extraction expert. Return only valid JSON.' },
              { role: 'user', content: dateExtractionPrompt }
            ],
            temperature: 0.2,
            max_tokens: 200,
            response_format: { type: 'json_object' },
          }),
        });

        if (dateResponse.ok) {
          const dateData = await dateResponse.json();
          const parsed = JSON.parse(dateData.choices[0].message.content);
          itineraryDateInfo = parsed.date_info || null;
          isItineraryQuery = true;
          console.log('[Chat API] Date extraction successful:', itineraryDateInfo);
        }
      } catch (err) {
        console.error('[Chat API] Date extraction failed:', err);
      }
    }
    
    console.log(`[Chat API] Router intent: ${routerIntent}, Task creation: ${isTaskCreationQuery}, Itinerary: ${isItineraryQuery}`);
    
    // Handle task creation queries first
    if (isTaskCreationQuery && !isItineraryQuery && taskExtractionResult) {
      try {
        console.log('[Chat API] ✓ Detected task creation query via LLM, creating task...');
        let isGapQuestion = false;
        const gapIntentPrompt = `Determine if this user message is asking about knowledge gaps or what they should study next.

Examples that ARE gap questions:
- "what gaps are there in my knowledge"
- "what should I study next"
- "what am I missing"

Examples that are NOT gap questions:
- "what is X" (asking for definition)
- "explain Y" (asking for explanation)
- General questions

User message: "${message}"

Return ONLY the JSON object:`;

        const gapResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are a helpful assistant that understands user intent. Return only valid JSON.' },
              { role: 'user', content: gapIntentPrompt }
            ],
            temperature: 0.2,
            max_tokens: 100,
          }),
        });

        if (gapResponse.ok) {
          const gapData = await gapResponse.json();
          const gapText = gapData.choices[0]?.message?.content?.trim() || '';
          const jsonMatch = gapText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            isGapQuestion = parsed.is_gap_question === true && parsed.confidence > 0.5;
            console.log(`[Chat API] LLM gap question analysis: is_gap_question=${isGapQuestion}, confidence=${parsed.confidence}`);
          }
        }
      } catch (err) {
        console.error('[Chat API] Error in LLM gap question detection:', err);
        // AI-first: No pattern matching fallback - if AI fails, assume not a gap question
        // This ensures we maintain AI-first principle
        isGapQuestion = false;
      }
    }

    // REMOVED: ~900 lines of unreachable classic mode code
    // This was dead code after the return statement on line 472.
    // All classic mode functionality has been removed as GraphRAG is always superior.

    let retrievalData: any = null;
    let retrievalIntent = 'DEFINITION_OVERVIEW';
    let trace: any[] = [];
    let context: any = {};
    let styleFeedbackResponse: PromiseSettledResult<Response | null>;
    
  // Declare variables that may be used in multiple code paths
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
    
    // Only fetch retrieval if router says we need it
    const retrievalStartTime = Date.now();
    let retrievalLatency = 0;
    if (routingResult.needsRetrieval) {
      // Build request body for intent-based retrieval
      const requestBody: any = {
        message,
        mode: 'graphrag',
        limit: 5,
        graph_id: defaultGraphId,
        branch_id: defaultBranchId,
        detail_level: 'summary', // Request summary mode for progressive disclosure
        trail_id,
        focus_concept_id,
        focus_quote_id,
        focus_page_url,
      };
      
      // PARALLEL: Fetch retrieval, style feedback, AND lecture mentions at the same time
      // Add 3-second timeout to retrieval to prevent hanging (reduced from 5s for faster UX)
      console.log('[Chat API] Fetching retrieval context, style feedback, and lecture mentions in parallel (3s timeout)...');
      const retrievalController = new AbortController();
      const retrievalTimeout = setTimeout(() => {
        retrievalController.abort();
      }, 3000); // 3 second timeout - fail fast if retrieval is slow
      
      // Build parallel fetch array
      const parallelFetches: Promise<any>[] = [
        fetch(`${API_BASE_URL}/ai/retrieve`, {
          method: 'POST',
          headers: getBackendHeaders(),
          body: JSON.stringify(requestBody),
          signal: retrievalController.signal,
        }).finally(() => clearTimeout(retrievalTimeout)),
        fetch(`${API_BASE_URL}/feedback/style/examples?limit=5`).catch(() => null), // Don't fail if this fails
        fetch(`${API_BASE_URL}/preferences/user-profile`).catch(() => null), // Fetch user profile for context
        fetch(`${API_BASE_URL}/preferences/conversation-summaries?limit=5`).catch(() => null), // Fetch recent summaries
        fetch(`${API_BASE_URL}/preferences/learning-topics?limit=10`).catch(() => null), // Fetch active learning topics
      ];
      
      const [retrievalResponse, styleFeedbackResponseResult, userProfileResponse, summariesResponse, topicsResponse] = await Promise.allSettled(parallelFetches);
      
      // Store style feedback response for later processing
      styleFeedbackResponse = styleFeedbackResponseResult;
      
      // Process user profile response
      if (userProfileResponse.status === 'fulfilled' && userProfileResponse.value) {
        try {
          const profileResult = userProfileResponse.value;
          if (profileResult.ok) {
            userProfile = await profileResult.json();
            console.log('[Chat API] ✓ Loaded user profile for context');
          }
        } catch (err) {
          console.warn('[Chat API] Failed to load user profile:', err);
        }
      }
      
      // Process conversation summaries for long-term context
      if (summariesResponse.status === 'fulfilled' && summariesResponse.value) {
        try {
          const summariesResult = summariesResponse.value;
          if (summariesResult.ok) {
            recentSummaries = await summariesResult.json();
            console.log(`[Chat API] ✓ Loaded ${recentSummaries.length} recent conversation summaries`);
          }
        } catch (err) {
          console.warn('[Chat API] Failed to load conversation summaries:', err);
        }
      }
      
      // Process learning topics for long-term context
      if (topicsResponse.status === 'fulfilled' && topicsResponse.value) {
        try {
          const topicsResult = topicsResponse.value;
          if (topicsResult.ok) {
            activeTopics = await topicsResult.json();
            console.log(`[Chat API] ✓ Loaded ${activeTopics.length} active learning topics`);
          }
        } catch (err) {
          console.warn('[Chat API] Failed to load learning topics:', err);
        }
      }
      
      // Store style feedback response for later processing (already stored above)

      // Process retrieval response
      if (retrievalResponse.status === 'fulfilled' && retrievalResponse.value) {
        const retrievalResult = retrievalResponse.value;
        if (retrievalResult.ok) {
          try {
            retrievalData = await retrievalResult.json();
            retrievalIntent = retrievalData.intent || 'DEFINITION_OVERVIEW';
            trace = retrievalData.trace || [];
            context = retrievalData.context || {};
            console.log(`[Chat API] Intent: ${retrievalIntent}, Trace steps: ${trace.length}`);
          } catch (err) {
            console.warn('[Chat API] Failed to parse retrieval response:', err);
          }
        } else {
          const errorText = await retrievalResult.text().catch(() => 'Unknown error');
          console.warn(`[Chat API] Retrieval failed: ${retrievalResult.status} ${errorText}`);
        }
      } else if (retrievalResponse.status === 'rejected') {
        const reason = retrievalResponse.reason;
        if (reason?.name === 'AbortError') {
          console.warn('[Chat API] Retrieval timed out after 3s, continuing without context');
          // Set empty context so the LLM can still respond
          context = {};
        } else {
          console.warn(`[Chat API] Retrieval failed: ${reason?.message || 'Unknown error'}`);
          // Set empty context so the LLM can still respond
          context = {};
        }
      }
    } else {
      console.log('[Chat API] Simple conversational query detected, skipping retrieval');
      // Fetch style feedback and user profile separately for conversational queries
      const styleFeedbackAndProfileResults = await Promise.allSettled([
        fetch(`${API_BASE_URL}/feedback/style/examples?limit=5`).catch(() => null),
        fetch(`${API_BASE_URL}/preferences/user-profile`).catch(() => null)
      ]);
      styleFeedbackResponse = styleFeedbackAndProfileResults[0];
      
      // Process user profile response
      const userProfileResultForSimple = styleFeedbackAndProfileResults[1];
      if (userProfileResultForSimple.status === 'fulfilled' && userProfileResultForSimple.value) {
        try {
          const profileResult = userProfileResultForSimple.value;
          if (profileResult && profileResult.ok) {
            userProfile = await profileResult.json();
            console.log('[Chat API] ✓ Loaded user profile for context');
          }
        } catch (err) {
          console.warn('[Chat API] Failed to load user profile:', err);
        }
      }
    }
    retrievalLatency = Date.now() - retrievalStartTime;
    
    // Build context text from structured context (empty if skipped retrieval)
    const contextResult = await buildContextTextFromStructured(context, retrievalIntent, message, apiKey);
    const contextText = contextResult.text;
    const printedClaims = contextResult.printedClaims;
    const printedQuotes = contextResult.printedQuotes;
    const printedSources = contextResult.printedSources;

    const lectureContext = '';
    
    // Process style feedback response (already fetched in parallel)
    // Process style feedback (only once to avoid "Body is unusable" error)
    // styleFeedbackResponse is set in both code paths above
    if (styleFeedbackResponse && styleFeedbackResponse.status === 'fulfilled' && styleFeedbackResponse.value) {
      try {
        const response = styleFeedbackResponse.value;
        if (response && response.ok) {
          const styleFeedbacks = await response.json();
          if (styleFeedbacks && styleFeedbacks.length > 0) {
            styleFeedbackExamples = styleFeedbacks.map((fb: any, idx: number) => {
              const original = (fb.original_response || '').substring(0, 200);
              const feedback = (fb.feedback_notes || '').substring(0, 200);
              const rewritten = fb.user_rewritten_version ? (fb.user_rewritten_version || '').substring(0, 200) : null;
              const testLabel = fb.test_label ? `${fb.test_label}: ` : '';
              let example = `${idx + 1}. ${testLabel}ORIGINAL: ${original}...\n   ${testLabel}FEEDBACK: ${feedback}...`;
              if (rewritten) {
                example += `\n   ${testLabel}REWRITTEN: ${rewritten}...`;
              }
              return example;
            }).join('\n\n');
            console.log(`[Chat API] ✓ Found ${styleFeedbacks.length} style feedback example(s) - will be included in GraphRAG prompt`);
          }
        }
      } catch (err) {
        console.warn('[Chat API] Failed to process style feedback:', err);
      }
    }
    
    // Build long-term memory context from summaries and topics
    let longTermContext = '';
    if (recentSummaries && recentSummaries.length > 0) {
      const summaryTexts = recentSummaries.slice(0, 3).map((s: any) => 
        `Previous: "${s.question}" → Topics: ${(s.topics || []).join(', ')}`
      ).join('\n');
      longTermContext += `## Recent Conversation History\n${summaryTexts}\n\n`;
    }
    if (activeTopics && activeTopics.length > 0) {
      const topicNames = activeTopics.slice(0, 5).map((t: any) => t.name).join(', ');
      longTermContext += `## Active Learning Topics\nYou've been learning about: ${topicNames}\n\n`;
    }
    
    // Build combined context text (Web search + GraphRAG context + lecture mentions + long-term memory)
    let combinedContextText = '';
    
    // Prepend web search results if available (most current/important)
    if (webSearchContext) {
      combinedContextText = webSearchContext;
    }
    
    // Add GraphRAG context
    if (contextText) {
      combinedContextText += (combinedContextText ? '\n\n' : '') + contextText;
    }
    
    // Add lecture context
    if (lectureContext) {
      combinedContextText += `\n\n${lectureContext}`;
    }
    
    // Prepend long-term memory context
    if (longTermContext) {
      combinedContextText = longTermContext + (combinedContextText ? '\n\n' : '') + combinedContextText;
    }
    
    console.log(`[Chat API] Context retrieved (${combinedContextText.length} chars)`);
    
    // Step 7: Dynamic Context Manager - Optimize context using AI importance scoring
    // Estimate max tokens for context (leave room for system prompt, user message, and response)
    // Typical: 128k context window, ~2k for system prompt, ~1k for user message, ~4k for response = ~121k for context
    // But we'll be more conservative: use ~100k tokens max for context
    const maxContextTokens = 100000; // Conservative limit
    const estimatedContextTokens = Math.ceil(combinedContextText.length / 4); // Rough estimate: 1 token ≈ 4 chars
    
    if (estimatedContextTokens > maxContextTokens * 0.8) { // If using >80% of limit, optimize
      console.log(`[Chat API] Context is large (${estimatedContextTokens} tokens), optimizing with AI...`);
      try {
        // Convert context into chunks for optimization
        const contextChunks: ContextChunk[] = [];
        
        // Extract session context chunks
        if (context.session_context) {
          contextChunks.push({
            content: JSON.stringify(context.session_context),
            type: 'session',
            id: context.session_context.trail_id,
          });
        }
        
        // Extract quote chunks
        const allQuotes = [
          ...(context.quotes || []),
          ...(context.focus_context?.quotes || []),
        ];
        allQuotes.forEach((q: any) => {
          contextChunks.push({
            content: q.text || q.content || q.quote_text || '',
            type: 'quote',
            id: q.quote_id || q.id,
          });
        });
        
        // Extract claim chunks
        const allClaims = [
          ...(context.claims || []),
          ...(context.focus_context?.claims || []),
          ...(context.top_claims || []),
        ];
        allClaims.forEach((c: any) => {
          contextChunks.push({
            content: c.text || c.content || c.claim_text || '',
            type: 'claim',
            id: c.claim_id || c.id,
          });
        });
        
        // Extract concept chunks
        const allConcepts = [
          ...(context.concepts || []),
          ...(context.focus_context?.concepts || []),
        ];
        allConcepts.forEach((concept: any) => {
          contextChunks.push({
            content: concept.description || concept.name || '',
            type: 'concept',
            id: concept.concept_id || concept.node_id || concept.id,
          });
        });
        
        // Now optimize using AI importance scoring
        // TODO: Implement optimizeContextWithAI function or remove this optimization step
        if (contextChunks.length > 0) {
          console.log(`[Chat API] Context optimization skipped - optimizeContextWithAI not implemented`);
          // For now, just use all chunks without optimization
          combinedContextText = contextChunks.map(chunk => chunk.content).join('\n\n');
        }
      } catch (err) {
        console.warn('[Chat API] Context optimization failed, using original context:', err);
      }
    }
    
    // If context is empty or very minimal, add a note to the prompt
    const contextNote = combinedContextText.trim().length === 0 
      ? "\n\nNOTE: No GraphRAG context was found for this query. You can still respond naturally using your general knowledge."
      : "";

    // Style feedback is already processed above - don't process again to avoid "Body is unusable" error
    
    // Build system prompt for GraphRAG
    // Build base system prompt for GraphRAG
    const strictnessNote = evidence_strictness === 'high' 
      ? '\n\nCRITICAL CITATION REQUIREMENTS (evidence_strictness=high):\n- Any factual assertion MUST include at least one citation token: [Quote: ...] OR [Claim: ...] OR [Source: ...]\n- If evidence is insufficient, say "Not enough evidence in your graph yet" and ask what to capture next.\n- Do not use general world knowledge unless explicitly labeled "General knowledge (uncited)" and only for background definitions.\n- Every sentence with verbs like "is/was/causes/leads to/results in/means" must cite evidence.\n'
      : evidence_strictness === 'medium'
      ? '\n\nCITATION GUIDELINES (evidence_strictness=medium):\n- Prefer citing evidence when available: [Quote: ...], [Claim: ...], or [Source: ...]\n- You may use general knowledge but prefer graph evidence when present.\n'
      : '';
    
    const baseSystemPromptGraphrag = `You are Brain Web, a teaching assistant and conversational agent.

CONVERSATIONAL CONTEXT:
- Maintain context from conversation history when relevant
- When the user asks "How does this relate to...", "What about...", or uses pronouns like "this", "that", "it" - identify what they're referring to from previous messages
- Connect follow-up questions to topics discussed earlier ONLY when the connection is clear and relevant
- Don't force connections to previous topics if the current question is unrelated
- Remember details the user has shared about themselves, their learning goals, and their background
- If the user asks about something mentioned earlier, reference that earlier discussion

When GraphRAG context is provided:
- Use the GraphRAG context to answer the question
- Cite specific claims and sources when relevant using citation tokens: [Quote: QUOTE_ID], [Claim: CLAIM_ID], [Source: URL]
- Reference communities when discussing related concepts
- Be specific and traceable to the provided evidence

When Web Search results are provided:
- Use the web search results to answer questions about current information
- Cite web sources naturally: "According to [source]..." or mention the source
- Web search results contain the most current/up-to-date information
- Prioritize web search results over training data for current events, recent news, current leadership, etc.

When GraphRAG context is empty or minimal:
- Answer questions directly using your general knowledge
- You do NOT need citations for general knowledge questions
- Be helpful and conversational
- Don't require specific graph context to respond
- Answer factual questions about real-world entities (companies, people, events, etc.) using your training data
- Only say "I don't have information" if you genuinely don't know the answer, not because there's no graph context
- If web search results are provided, use those instead of training data for current information

CITATION TOKEN RULES (ONLY when GraphRAG context is provided):
- When GraphRAG context is available, factual assertions about graph content should include citation tokens: [Quote: ...] OR [Claim: ...] OR [Source: ...]
- When GraphRAG context is empty, answer using general knowledge WITHOUT citations
- If evidence is insufficient in the graph, say "Not enough evidence in your graph yet" and ask for what to capture next
- Use exact IDs from the context (quote_id, claim_id, source URLs)
- You may ONLY cite evidence IDs/URLs that appear in the Allowed Evidence IDs list (if provided)${strictnessNote}

CRITICAL: Answer General Knowledge Questions Directly
- When asked about general knowledge (companies, people, historical events, etc.), answer directly using your training data
- Be SPECIFIC and FACTUAL: mention actual names, dates, events, and concrete details
- DO NOT say "I don't have information" just because there's no graph context - use your general knowledge instead
- Only admit uncertainty if you genuinely don't know the answer in your training data
- Example of GOOD response: "The CEO of Tata Mobile (now Tata Teleservices) is [actual name]. The company was merged with Bharti Airtel in 2019."
- Example of BAD response: "I don't have specific information about the CEO of Tata Mobile" (when you could answer from general knowledge)

The context provided includes (in priority order):
- Web Search Results (if provided): Current information from the internet with source links
- Session Context (trail summary + focus context)
- Supporting Quotes with IDs: [Quote: QUOTE_ID]
- Supporting Claims with IDs: [Claim: CLAIM_ID]
- Relevant communities of related concepts
- Relevant concepts and their relationships

Your task:
1. If Web Search results are provided, use them FIRST for current information - they are the most up-to-date
2. If GraphRAG context is available, use it to answer the question and cite sources
3. If GraphRAG context is empty or minimal, answer using your general knowledge directly - no citations needed
4. For general knowledge questions (companies, people, events), answer factually from your training data UNLESS web search results are provided
5. Only cite sources when GraphRAG context is provided - general knowledge and web search results don't need citation tokens
6. Reference communities when discussing related concepts (if available) - mention them naturally without using **bold** markdown formatting
7. Connect to previous conversation topics ONLY when relevant - don't force connections
8. Be conversational and helpful - answer questions directly rather than deflecting

FORMATTING REQUIREMENTS:
- Use clear paragraphs separated by blank lines
- Use bullet points (- or •) for lists
- Break up long paragraphs into shorter, readable chunks
- Use line breaks to separate major sections
- Do NOT use **bold** markdown formatting for concepts, nodes, or section headers - mention them naturally

Format your response as:
ANSWER: <your well-formatted answer>
SUGGESTED_ACTIONS: [optional array of actions]
FOLLOW_UP_QUESTIONS: [optional array of questions]`;

    // Add personalization layers
    const additionalLayers: string[] = [];
    
    // Layer 0: Teaching Style Profile (highest priority - learned from lectures)
    if (teachingStyleProfile) {
      const style = teachingStyleProfile;
      const teachingStyleInstructions = `

The user has a specific teaching and writing style.
You MUST emulate this style when answering.

Here is the Teaching Style Profile as JSON:
${JSON.stringify(teachingStyleProfile, null, 2)}

Key rules:
- Follow the explanation_order: ${style.explanation_order.join(' → ')}.
- Match the tone: ${style.tone}.
- Use this teaching style: ${style.teaching_style}.
- Write with this sentence structure: ${style.sentence_structure}.
- Avoid all patterns listed in forbidden_styles: ${style.forbidden_styles.join(', ')}.
- Keep responses concise and grounded, not generic.

This style was learned from the user's actual lectures and represents how they explain concepts.
`;
      additionalLayers.push(teachingStyleInstructions);
    }
    
    // Layer 1: Response Style Profile
    if (styleProfile && styleProfile.profile) {
      const style = styleProfile.profile;
      const styleInstructions = `

You must follow this response style profile:

Tone: ${style.tone}
Teaching style: ${style.teaching_style}
Sentence structure: ${style.sentence_structure}
Explain concepts in this order: ${style.explanation_order.join(', ')}.
Never use the following styles: ${style.forbidden_styles.join(', ')}.
`;
      additionalLayers.push(styleInstructions);
    }
    
    // Layer 2: Feedback Summary
    if (feedbackSummary && feedbackSummary.total > 0) {
      const feedbackInstructions = `

You have feedback on recent answers:

Total ratings: ${feedbackSummary.total}
Positive: ${feedbackSummary.positive}, Negative: ${feedbackSummary.negative}

Common negative reasons (avoid these): ${JSON.stringify(feedbackSummary.common_reasons)}

Avoid patterns that produced negative feedback, especially ones marked as "too generic" or "not connected to the graph".
`;
      additionalLayers.push(feedbackInstructions);
    }
    
    // Layer 3: Focus Areas
    const activeFocusAreas = focusAreas.filter((fa: any) => fa.active);
    if (activeFocusAreas.length > 0) {
      const focusText = activeFocusAreas.map((f: any) => f.name).join(', ');
      const focusInstructions = `

The user is currently focusing on these themes: ${focusText}.
Whenever possible, connect explanations back to these focus areas.
If a question is broad, use these as anchoring contexts.
`;
      additionalLayers.push(focusInstructions);
    }
    
    // Layer 4: User Profile
    if (userProfile) {
      const profileInstructions = `

User profile:
- Name: ${userProfile.name || 'User'}
- Background: ${userProfile.background.join(', ') || 'none specified'}
- Interests: ${userProfile.interests.join(', ') || 'none specified'}
- Weak spots: ${userProfile.weak_spots.join(', ') || 'none specified'}
- Learning preferences: ${JSON.stringify(userProfile.learning_preferences)}

When explaining:
- Avoid re-explaining fundamentals in areas of strong background unless asked.
- Pay extra attention to weak spots; build bridges from known background.
- Use analogies and layered explanations if preferred.
`;
      additionalLayers.push(profileInstructions);
    }
    
    // Layer 5: Style Feedback Examples (for learning from user's own feedback)
    if (styleFeedbackExamples) {
      const styleFeedbackLayer = `

RECENT STYLE FEEDBACK EXAMPLES (learn from these patterns):
${styleFeedbackExamples}

Use these examples to refine your responses. Pay attention to what the user liked and disliked. Match the style of responses they approved of.
`;
      additionalLayers.push(styleFeedbackLayer);
    }
    
    // Use PromptBuilder to compose system prompt with response preferences
    const { systemPrompt, maxTokens } = buildPrompt(
      baseSystemPromptGraphrag,
      finalResponsePrefs,
      finalVoiceId,
      additionalLayers
    );
    
    // Build conversation summary for context
    const conversationSummary = chatHistory ? buildConversationSummary(chatHistory) : '';
    
    // Build messages with conversation history
    const messages = buildMessagesWithHistory(systemPrompt, message, combinedContextText + contextNote, chatHistory, conversationSummary, userProfile, ui_context);
    
    // Call OpenAI Chat Completions API
    console.log('[Chat API] Calling OpenAI API for GraphRAG response...');
    const openaiStartTime = Date.now();
    const openaiResponseGraphrag = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.7,
        max_tokens: maxTokens,
      }),
    });

    if (!openaiResponseGraphrag.ok) {
      const errorData = await openaiResponseGraphrag.json().catch(() => ({}));
      console.error(`[Chat API] OpenAI API error: ${openaiResponseGraphrag.status}`, errorData);
      throw new Error(`OpenAI API error: ${openaiResponseGraphrag.statusText} - ${JSON.stringify(errorData)}`);
    }

    const openaiData = await openaiResponseGraphrag.json();
    const responseText = openaiData.choices[0]?.message?.content || '';
    const finishReason = openaiData.choices[0]?.finish_reason;
    wasTruncated = finishReason === 'length';
    
    if (wasTruncated) {
      console.warn(`[Chat API] Response was truncated by token limit (finish_reason: ${finishReason})`);
    }
    
    const openaiTime = Date.now() - openaiStartTime;
    console.log(`[Chat API] OpenAI API call took ${openaiTime}ms`);

    // Parse response
    answer = responseText;
    suggestedQuestions = [];
    suggestedActions = [];

    // Try to extract SUGGESTED_ACTIONS first (before removing other sections)
    // NOTE: avoid the `/s` (dotAll) flag for broader TS targets
    actionsMatch = responseText.match(/SUGGESTED_ACTIONS:\s*\[([\s\S]*?)\]/);
    if (actionsMatch) {
      try {
        const actionsStr = actionsMatch[1];
        // Try to parse as JSON array - look for the array content
        const jsonArrayMatch = actionsStr.match(/\[([\s\S]*?)\]/);
        if (jsonArrayMatch) {
          const actionsJson = '[' + jsonArrayMatch[1] + ']';
          suggestedActions = JSON.parse(actionsJson);
        } else {
          // Fallback: try to extract individual action objects
          const actionMatches = actionsStr.match(/\{[^}]+\}/g) as string[] | null;
          if (actionMatches) {
            suggestedActions = actionMatches
              .map((actionStr: string): SuggestedAction | null => {
                try {
                  return JSON.parse(actionStr) as SuggestedAction;
                } catch {
                  return null;
                }
              })
              .filter((a: SuggestedAction | null): a is SuggestedAction => a !== null);
          }
        }
        console.log(`[Chat API] Parsed ${suggestedActions.length} suggested actions`);
      } catch (err) {
        console.warn('[Chat API] Failed to parse suggested actions:', err);
      }
      // Remove the SUGGESTED_ACTIONS section from answer
      answer = answer.split('SUGGESTED_ACTIONS:')[0].trim();
    }

    // Try to extract FOLLOW_UP_QUESTIONS
    followUpMatch = answer.match(/FOLLOW_UP_QUESTIONS:\s*\[([\s\S]*?)\]/);
    if (followUpMatch) {
      try {
        const questionsStr = followUpMatch[1];
        // Extract quoted strings
        const questionMatches = (questionsStr.match(/'([^']+)'/g) || questionsStr.match(/"([^"]+)"/g)) as
          | string[]
          | null;
        if (questionMatches) {
          suggestedQuestions = questionMatches.map((q: string) => q.slice(1, -1));
        }
      } catch (err) {
        console.warn('[Chat API] Failed to parse follow-up questions:', err);
      }
      // Remove the FOLLOW_UP_QUESTIONS section from answer
      answer = answer.split('FOLLOW_UP_QUESTIONS:')[0].trim();
    }

    // Remove ANSWER: prefix if present
    if (answer.startsWith('ANSWER:')) {
      answer = answer.substring(7).trim();
    }
    
    // Format answer with proper line breaks
    answer = answer
      .replace(/\n\n+/g, '\n\n')
      .replace(/^[-•]\s+/gm, '• ')
      // Remove bold markdown formatting (**text** becomes text)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .trim();

    // Step 6: Generate answerId and store answer
    answerId = `answer-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    // Store answer in backend
    try {
      const storeResponse = await fetch(`${API_BASE_URL}/answers/store`, {
        method: 'POST',
        headers: getBackendHeaders(),
        body: JSON.stringify({
          answer_id: answerId,
          question: message,
          raw_answer: answer,
          used_node_ids: usedNodes.map(n => n.node_id),
        }),
      });
      if (storeResponse.ok) {
        // Log answer created event
        try {
          await fetch(`${API_BASE_URL}/events/activity`, {
            method: 'POST',
            headers: getBackendHeaders(),
            body: JSON.stringify({
              type: 'ANSWER_CREATED',
              answer_id: answerId,
              graph_id: graph_id || undefined,
              payload: { conceptIdsUsed: usedNodes.map(n => n.node_id) },
            }),
          }).catch(() => {}); // Swallow errors
        } catch {
          // Ignore event logging errors
        }
      } else {
        console.warn('[Chat API] Failed to store answer:', await storeResponse.text());
      }
    } catch (err) {
      console.warn('[Chat API] Error storing answer:', err);
    }
    
    // Step 7: Extract and store conversation summary and learning topics (async, don't block)
    // This runs in the background to build long-term memory
    (async () => {
      try {
        // Extract topics and summary using AI
        const extractionPrompt = `Extract key information from this conversation exchange.

QUESTION: ${message.substring(0, 500)}
ANSWER: ${answer.substring(0, 1000)}

Return ONLY a JSON object:
{
  "topics": ["topic1", "topic2", ...],
  "summary": "brief 1-2 sentence summary of what was discussed"
}

Focus on:
- Main topics/concepts discussed (2-5 topics max)
- What the user learned or asked about
- Key relationships or connections mentioned`;

        const extractionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are a conversation analyzer. Return only valid JSON.' },
              { role: 'user', content: extractionPrompt }
            ],
            temperature: 0.2,
            max_tokens: 300,
            response_format: { type: 'json_object' },
          }),
        });

        if (extractionResponse.ok) {
          const extractionData = await extractionResponse.json();
          const extracted = JSON.parse(extractionData.choices[0].message.content);
          const topics = extracted.topics || [];
          const summary = extracted.summary || '';

          // Store conversation summary
          const summaryId = `summary-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
          await fetch(`${API_BASE_URL}/preferences/conversation-summaries`, {
            method: 'POST',
            headers: getBackendHeaders(),
            body: JSON.stringify({
              id: summaryId,
              timestamp: Math.floor(Date.now() / 1000),
              question: message,
              answer: answer.substring(0, 2000), // Limit length
              topics: topics.slice(0, 5), // Max 5 topics
              summary: summary,
            }),
          }).catch(err => console.warn('[Chat API] Failed to store conversation summary:', err));

          // Store learning topics
          for (const topicName of topics.slice(0, 5)) {
            if (topicName && topicName.length > 2) {
              const topicId = `topic-${topicName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
              await fetch(`${API_BASE_URL}/preferences/learning-topics`, {
                method: 'POST',
                headers: getBackendHeaders(),
                body: JSON.stringify({
                  id: topicId,
                  name: topicName,
                  first_mentioned: Math.floor(Date.now() / 1000),
                  last_mentioned: Math.floor(Date.now() / 1000),
                  mention_count: 1,
                  related_topics: topics.filter((t: string) => t !== topicName).slice(0, 3),
                  notes: summary,
                }),
              }).catch(err => console.warn('[Chat API] Failed to store learning topic:', err));
            }
          }
          
          console.log(`[Chat API] ✓ Stored conversation summary and ${topics.length} learning topics`);
        }
      } catch (err) {
        console.warn('[Chat API] Error extracting/storing conversation summary:', err);
        // Don't fail the request if this fails
      }
    })();
    
    // Get gap detection questions from backend
    let gapQuestions: string[] = [];
    try {
      const gapResponse = await fetch(`${API_BASE_URL}/concepts/gaps?limit=3`, {
        headers: getBackendHeaders(),
      });
      if (gapResponse.ok) {
        const gapConcepts: string[] = await gapResponse.json();
        gapQuestions = gapConcepts.map(name => `How would you define ${name} in your own words?`);
        console.log(`[Chat API] Found ${gapQuestions.length} gap questions`);
      }
    } catch (err) {
      console.warn('[Chat API] Failed to fetch gap questions:', err);
    }
    
    // Merge suggested questions: API questions first, then gap questions
    const mergedQuestions = [...suggestedQuestions, ...gapQuestions].slice(0, 3);
    
    // If no questions found, generate some defaults
    if (mergedQuestions.length === 0) {
      suggestedQuestions = [
        `Tell me more about ${usedNodes[0]?.name || 'this topic'}`,
        `How does ${usedNodes[0]?.name || 'this'} relate to other concepts?`,
      ];
    } else {
      suggestedQuestions = mergedQuestions;
    }

    // Generate answer sections for inline claim alignment
    sections = splitAnswerIntoSections(answer);
    // Map evidence to sections (convert claim IDs to EvidenceItem format)
    // For now, we only have claim IDs, so we'll pass empty array - evidence mapping can be enhanced later
    const evidenceItems: EvidenceItem[] = []; // TODO: Convert printedClaims (string[]) to EvidenceItem[] if needed
    answer_sections = mapEvidenceToSections(sections, evidenceItems);

    duration = Date.now() - startTime;
    console.log(`[Chat API] GraphRAG mode completed in ${duration}ms`);

    const response: ChatResponse = {
      answer,
      usedNodes,
      suggestedQuestions: suggestedQuestions.slice(0, 3), // Limit to 3
      suggestedActions: suggestedActions.slice(0, 5), // Limit to 5 actions
      answerId,
      answer_sections,
      ...(process.env.NODE_ENV === 'development' && { 
        meta: {
          mode: 'graphrag',
          duration_ms: duration,
          intent: retrievalIntent,
          traceSteps: trace.length,
          rewriteApplied: false,
        }
      }),
    };

    if (retrievalData?.context?.retrieval_meta) {
      const metaSource = retrievalData.context.retrieval_meta || {};
      const retrievalMeta = { ...metaSource };
      if (Array.isArray(retrievalMeta.topClaims) && retrievalMeta.topClaims.length > 5) {
        retrievalMeta.topClaims = retrievalMeta.topClaims.slice(0, 5);
      }
      response.retrievalMeta = retrievalMeta;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('GraphRAG Chat API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      {
        error: errorMessage,
        answer: `I encountered an error while processing your question in GraphRAG mode: ${errorMessage}. ${errorMessage.includes('Backend connection') ? 'Please make sure the backend server is running on port 8000.' : 'Please try again.'}`,
        usedNodes: [],
        suggestedQuestions: [],
      },
      { status: 500 }
    );
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
  
  // Phase C: Session Context (trail summary + focus context brief)
  if (context.session_context || context.focus_context) {
    parts.push("## Session Context");
    
    if (context.session_context) {
      const trail = context.session_context;
      parts.push(`\nTrail: ${trail.summary || `Trail ${trail.trail_id} with ${trail.steps?.length || 0} steps`}`);
    }
    
    if (context.focus_context) {
      const focus = context.focus_context;
      if (focus.focus_type === 'concept' && focus.concept) {
        parts.push(`\nFocus: Concept "${focus.concept.name}" [Concept: ${focus.concept.concept_id}]`);
      } else if (focus.focus_type === 'quote' && focus.quotes?.length > 0) {
        const q = focus.quotes[0];
        parts.push(`\nFocus: Quote [Quote: ${q.quote_id}]`);
        printedQuotes.push(q.quote_id);
      } else if (focus.focus_type === 'page' && focus.sources?.length > 0) {
        const s = focus.sources[0];
        parts.push(`\nFocus: Page ${s.title || s.url} [Source: ${s.url}]`);
        if (s.url) printedSources.push(s.url);
      }
    }
    
    parts.push("");
  }
  
  // Phase C: Supporting Quotes (include quote_id + text + source url)
  const allQuotes: any[] = [];
  
  // Collect quotes from focus_context
  if (context.focus_context?.quotes) {
    allQuotes.push(...context.focus_context.quotes);
  }
  
  // Collect quotes from claims (if they have quote references)
  // Note: We'll format quotes separately from claims
  
  if (allQuotes.length > 0) {
    parts.push("## Supporting Quotes");
    // Use AI-based dynamic context manager to select most important quotes
    const quoteChunks: ContextChunk[] = allQuotes.map((quote: any) => ({
      content: quote.text || '',
      type: 'quote' as const,
      id: quote.quote_id,
    }));
    const optimizedQuotes = await buildOptimizedContext(quoteChunks, question, 4000, apiKey); // ~1000 tokens for quotes
    const quotesToPrint = optimizedQuotes.selectedChunks.map(chunk => 
      allQuotes.find((q: any) => q.quote_id === chunk.id) || allQuotes[0]
    ).slice(0, 10); // Still limit to 10 for safety
    for (const quote of quotesToPrint) {
      const quoteId = quote.quote_id || '';
      const text = quote.text || '';
      const sourceUrl = quote.source_url || '';
      const sourceTitle = quote.source_title || '';
      
      if (quoteId) printedQuotes.push(quoteId);
      if (sourceUrl) printedSources.push(sourceUrl);
      
      parts.push(`\nQuote: "${text.substring(0, 200)}${text.length > 200 ? '...' : ''}" [Quote: ${quoteId}]`);
      if (sourceUrl) {
        parts.push(`  Source: ${sourceTitle || sourceUrl} [Source: ${sourceUrl}]`);
      }
    }
    parts.push("");
  }
  
  // Phase C: Supporting Claims (include claim_id + text + confidence + evidencing quote_ids)
  const allClaims: any[] = [];
  
  // Collect claims from focus_context
  if (context.focus_context?.claims) {
    allClaims.push(...context.focus_context.claims);
  }
  
  // Collect claims from main context
  if (context.claims) {
    allClaims.push(...context.claims);
  }
  
  if (allClaims.length > 0) {
    parts.push("## Supporting Claims");
    const claimsToPrint = allClaims.slice(0, 10);
    for (const claim of claimsToPrint) {
      const claimId = claim.claim_id || '';
      const text = claim.text || '';
      const confidence = claim.confidence || 0.5;
      const quoteIds = claim.evidencing_quote_ids || [];
      
      if (claimId) printedClaims.push(claimId);
      
      parts.push(`\nClaim: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''} [Claim: ${claimId}] (confidence ${confidence.toFixed(2)})`);
      if (quoteIds.length > 0) {
        parts.push(`  Evidenced by quotes: ${quoteIds.map((id: string) => `[Quote: ${id}]`).join(', ')}`);
        quoteIds.forEach((id: string) => {
          if (id && !printedQuotes.includes(id)) printedQuotes.push(id);
        });
      }
      if (claim.source_id) {
        parts.push(`  Source: ${claim.source_id}`);
      }
    }
    parts.push("");
  }
  
  // Add communities section (summary mode: names only, max 3, no summaries)
  if (context.focus_communities && context.focus_communities.length > 0) {
    parts.push("## Community Summaries (Global Memory)");
    // Use AI-based dynamic context manager to select most important communities
    const communityChunks: ContextChunk[] = context.focus_communities.map((comm: any) => ({
      content: comm.name || comm.community_id || '',
      type: 'community' as const,
      id: comm.community_id,
    }));
    const optimizedCommunities = await buildOptimizedContext(communityChunks, question, 1000, apiKey);
    const communitiesToPrint = optimizedCommunities.selectedChunks.map(chunk => 
      context.focus_communities.find((c: any) => c.community_id === chunk.id) || context.focus_communities[0]
    ).slice(0, 3); // Limit to 3 for summary mode
    for (const comm of communitiesToPrint) {
      parts.push(`\n### ${comm.name || comm.community_id}`);
      // Summary mode: no long summary text, just names
    }
    parts.push("");
  }
  
  // Add concepts section (summary mode: max 5, no descriptions)
  if (context.focus_entities && context.focus_entities.length > 0) {
    parts.push("## Relevant Concepts");
    // Use AI-based dynamic context manager to select most important concepts
    const conceptChunks: ContextChunk[] = context.focus_entities.map((concept: any) => ({
      content: concept.name || concept.description || '',
      type: 'concept' as const,
      id: concept.node_id || concept.concept_id,
    }));
    const optimizedConcepts = await buildOptimizedContext(conceptChunks, retrievalIntent, 2000, apiKey);
    const conceptsToPrint = optimizedConcepts.selectedChunks.map(chunk => 
      context.focus_entities.find((c: any) => (c.node_id || c.concept_id) === chunk.id) || context.focus_entities[0]
    ).slice(0, 5); // Limit to 5 for summary mode
    for (const concept of conceptsToPrint) {
      parts.push(`\n### ${concept.name}`);
      // Summary mode: no descriptions, just names
      if (concept.domain) {
        parts.push(`Domain: ${concept.domain}`);
      }
      if (concept.type) {
        parts.push(`Type: ${concept.type}`);
      }
    }
    parts.push("");
  }
  
  // Intent-specific sections
  if (retrievalIntent === 'TIMELINE' && context.timeline_items) {
    parts.push("## Timeline");
    // Use AI-based dynamic context manager to select most important timeline items
    const timelineChunks: ContextChunk[] = context.timeline_items.map((item: any) => ({
      content: item.text || `${item.date || 'unknown'}: ${item.text || ''}`,
      type: 'source' as const,
      id: item.item_id || item.date,
    }));
    const optimizedTimeline = await buildOptimizedContext(timelineChunks, question, 3000, apiKey);
    const timelineToPrint = optimizedTimeline.selectedChunks.map(chunk => 
      context.timeline_items.find((item: any) => (item.item_id || item.date) === chunk.id) || context.timeline_items[0]
    ).slice(0, 15); // Limit to 15 for timeline
    for (const item of timelineToPrint) {
      parts.push(`\n[${item.date || 'unknown'}] ${item.text}`);
    }
    parts.push("");
  }
  
  if (retrievalIntent === 'CAUSAL_CHAIN' && context.causal_paths) {
    parts.push("## Causal Paths");
    // Use AI-based dynamic context manager to select most important causal paths
    const pathChunks: ContextChunk[] = context.causal_paths.map((path: any) => ({
      content: `Path with ${path.nodes?.length || 0} nodes, ${path.edges?.length || 0} edges`,
      type: 'source' as const,
      id: path.path_id || `path-${path.nodes?.[0]?.node_id || 'unknown'}`,
    }));
    const optimizedPaths = await buildOptimizedContext(pathChunks, question, 2000, apiKey);
    const pathsToPrint = optimizedPaths.selectedChunks.map(chunk => 
      context.causal_paths.find((p: any) => (p.path_id || `path-${p.nodes?.[0]?.node_id || 'unknown'}`) === chunk.id) || context.causal_paths[0]
    ).slice(0, 3); // Limit to 3 for causal paths
    for (const path of pathsToPrint) {
      parts.push(`\nPath with ${path.nodes?.length || 0} nodes, ${path.edges?.length || 0} edges`);
      if (path.supporting_claim_ids) {
        parts.push(`Supported by ${path.supporting_claim_ids.length} claims`);
      }
    }
    parts.push("");
  }
  
  if (retrievalIntent === 'COMPARE' && context.compare) {
    parts.push("## Comparison");
    parts.push(`\nComparing: ${context.compare.A?.name || 'A'} vs ${context.compare.B?.name || 'B'}`);
    if (context.compare.overlaps?.shared_concepts) {
      parts.push(`\nShared concepts: ${context.compare.overlaps.shared_concepts.length}`);
    }
    parts.push("");
  }
  
  if (retrievalIntent === 'EVIDENCE_CHECK' && context.evidence) {
    parts.push("## Evidence");
    if (context.evidence.supporting) {
      parts.push(`\nSupporting claims: ${context.evidence.supporting.length}`);
    }
    if (context.evidence.conflicting) {
      parts.push(`Conflicting claims: ${context.evidence.conflicting.length}`);
    }
    if (context.evidence.sources) {
      parts.push(`Unique sources: ${context.evidence.sources.length}`);
    }
    parts.push("");
  }
  
  // Summary mode: no chunks by default
  // Chunks are omitted in summary mode to reduce payload size
  
  return {
    text: parts.join("\n"),
    printedClaims: Array.from(new Set(printedClaims)), // Deduplicate
    printedQuotes: Array.from(new Set(printedQuotes)),
    printedSources: Array.from(new Set(printedSources)),
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
