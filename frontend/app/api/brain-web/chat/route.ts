import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

// In Next.js, environment variables without NEXT_PUBLIC_ prefix are only available server-side
// OPENAI_API_KEY should be in .env.local (not .env.local.public)
// Note: Next.js caches env vars at build time, so restart dev server after changing .env.local

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
    // Default to GraphRAG for better evidence and structured context
    // Frontend can override with 'classic' for simple queries
    const { message: initialMessage, mode = 'graphrag', graph_id, branch_id, lecture_id, vertical: initialVertical, lens: initialLens, recency_days, evidence_strictness, include_proposed_edges, response_prefs, voice_id, chatHistory, trail_id, focus_concept_id, focus_quote_id, focus_page_url } = body;
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
    console.log(`[Chat API] Processing question: "${message.substring(0, 50)}..." (mode: ${mode})`);

    // Handle GraphRAG mode
    if (mode === 'graphrag') {
      const result = await handleGraphRAGMode(message, graph_id, branch_id, lecture_id, apiKey, vertical, lens, recency_days, evidence_strictness, include_proposed_edges, finalResponsePrefs, finalVoiceId, chatHistory, trail_id, focus_concept_id, focus_quote_id, focus_page_url);
      const totalDuration = Date.now() - startTime;
      console.log(`[Chat API] GraphRAG mode completed in ${totalDuration}ms`);
      return result; // handleGraphRAGMode already includes metrics
    }

    // Classic mode (existing flow)
    // Step 1: Call semantic search
    console.log(`[Chat API] Step 1: Calling semantic search at ${API_BASE_URL}/ai/semantic-search`);
    const searchResponse = await fetch(`${API_BASE_URL}/ai/semantic-search`, {
      method: 'POST',
      headers: getBackendHeaders(),
      body: JSON.stringify({ message, limit: 5 }),
    });

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error(`[Chat API] Semantic search failed: ${searchResponse.status} ${errorText}`);
      throw new Error(`Semantic search failed: ${searchResponse.statusText}`);
    }

    const searchData: SemanticSearchResponse = await searchResponse.json();
    console.log(`[Chat API] Found ${searchData.nodes.length} relevant nodes`);
    const usedNodes = searchData.nodes;

    if (usedNodes.length === 0) {
      console.log('[Chat API] No nodes found, returning early');
      return NextResponse.json({
        answer: "I couldn't find any relevant nodes in your knowledge graph for that question. Try asking about a specific concept or topic.",
        usedNodes: [],
        suggestedQuestions: [],
      });
    }

    // Use LLM to detect "gaps" questions intelligently (what don't I know, what should I learn, etc.)
    let isGapQuestion = false;
    try {
      const hasGapKeywords = /(?:gap|missing|don.*know|need.*learn|should.*study|what.*missing|knowledge.*gap)/i.test(message);
      if (hasGapKeywords) {
        const gapIntentPrompt = `Determine if this user message is asking about knowledge gaps, missing information, or what they should learn next.

Return ONLY a JSON object: {"is_gap_question": true/false, "confidence": 0.0-1.0}

Examples of gap questions:
- "what don't I know about X"
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
      }
    } catch (err) {
      console.error('[Chat API] Error in LLM gap question detection:', err);
      // Fallback to pattern matching
      isGapQuestion = /gap|missing|what.*don.*know|what.*need.*learn|what.*should.*study/i.test(message);
    }
    let allDomainNodes: Concept[] = [];
    
    if (isGapQuestion && usedNodes.length > 0) {
      // Get the primary domain from search results
      const primaryDomain = usedNodes[0].domain;
      console.log(`[Chat API] Gap question detected, fetching all nodes in domain: ${primaryDomain}`);
      
      try {
        // Get all graph data and filter by domain
        const allGraphResponse = await fetch(`${API_BASE_URL}/concepts/all/graph`);
        if (allGraphResponse.ok) {
          const allGraph = await allGraphResponse.json();
          allDomainNodes = allGraph.nodes.filter((n: Concept) => 
            n.domain === primaryDomain || n.domain.toLowerCase().includes(primaryDomain.toLowerCase())
          );
          console.log(`[Chat API] Found ${allDomainNodes.length} total nodes in ${primaryDomain} domain`);
        }
      } catch (err) {
        console.warn(`[Chat API] Failed to fetch all domain nodes:`, err);
      }
    }

    // Use LLM to detect if user is asking about previous definitions/explanations
    let isPreviousDefinitionQuestion = false;
    try {
      const hasPreviousKeywords = /(?:previously|before|earlier|in the past|have.*you|did.*you)/i.test(message);
      if (hasPreviousKeywords) {
        const previousIntentPrompt = `Determine if this user message is asking about what was said/explained/defined PREVIOUSLY in the conversation.

Return ONLY a JSON object: {"is_previous_definition_question": true/false, "confidence": 0.0-1.0}

Examples of previous definition questions:
- "how did you previously define X"
- "what did you say about Y earlier"
- "how have you explained Z before"

Examples that are NOT:
- "what is X" (asking for current definition)
- "explain Y" (asking for explanation now)
- General questions without "previously/before/earlier"

User message: "${message}"

Return ONLY the JSON object:`;

        const previousResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are a helpful assistant that understands user intent. Return only valid JSON.' },
              { role: 'user', content: previousIntentPrompt }
            ],
            temperature: 0.2,
            max_tokens: 100,
          }),
        });

        if (previousResponse.ok) {
          const previousData = await previousResponse.json();
          const previousText = previousData.choices[0]?.message?.content?.trim() || '';
          const jsonMatch = previousText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            isPreviousDefinitionQuestion = parsed.is_previous_definition_question === true && parsed.confidence > 0.5;
            console.log(`[Chat API] LLM previous definition analysis: is_previous=${isPreviousDefinitionQuestion}, confidence=${parsed.confidence}`);
          }
        }
      }
    } catch (err) {
      console.error('[Chat API] Error in LLM previous definition detection:', err);
      // Fallback to pattern matching
      isPreviousDefinitionQuestion = /how.*(have|did).*you.*(previously|before|earlier|in the past).*(define|explain|describe|say about)|what.*(have|did).*you.*(previously|before|earlier).*(say|explain|define|describe).*about/i.test(message);
    }
    
    // Step 2.5: Fetch segments for concepts if asking about previous definitions
    const segmentsByConcept: Record<string, any[]> = {};
    if (isPreviousDefinitionQuestion && usedNodes.length > 0) {
      console.log(`[Chat API] Step 2.5: Fetching segments for ${usedNodes.length} concepts`);
      for (const node of usedNodes) {
        try {
          const segmentsResponse = await fetch(
            `${API_BASE_URL}/lectures/segments/by-concept/${encodeURIComponent(node.name)}`
          );
          if (segmentsResponse.ok) {
            const segments = await segmentsResponse.json();
            if (segments.length > 0) {
              segmentsByConcept[node.name] = segments;
              console.log(`[Chat API] Found ${segments.length} segment(s) for "${node.name}"`);
            }
          }
        } catch (err) {
          console.warn(`[Chat API] Failed to fetch segments for "${node.name}":`, err);
        }
      }
    }

    // Step 2: Get neighbors for context
    console.log(`[Chat API] Step 2: Fetching neighbors for ${usedNodes.length} nodes`);
    const nodeIds = usedNodes.map(n => n.node_id);
    const neighborMap: Record<string, Concept[]> = {};

    for (const nodeId of nodeIds) {
      try {
        const neighborsResponse = await fetch(`${API_BASE_URL}/concepts/${nodeId}/neighbors`);
        if (neighborsResponse.ok) {
          neighborMap[nodeId] = await neighborsResponse.json();
        }
      } catch (err) {
        console.warn(`[Chat API] Failed to fetch neighbors for ${nodeId}:`, err);
      }
    }

    // Step 3: Build context string
    const contextParts: string[] = [];
    
    // For gap questions, include all domain nodes
    if (isGapQuestion && allDomainNodes.length > 0) {
      contextParts.push(`ALL NODES IN ${usedNodes[0].domain.toUpperCase()} DOMAIN:`);
      const domainNodeNames = allDomainNodes.map(n => n.name).join(', ');
      contextParts.push(`Existing concepts: ${domainNodeNames}`);
      contextParts.push(`Total: ${allDomainNodes.length} concepts`);
      contextParts.push('');
    }
    
    // Add segments if asking about previous definitions
    if (isPreviousDefinitionQuestion && Object.keys(segmentsByConcept).length > 0) {
      contextParts.push('HOW YOU\'VE EXPLAINED THESE CONCEPTS BEFORE (FROM YOUR LECTURES):');
      for (const node of usedNodes) {
        const segments = segmentsByConcept[node.name];
        if (segments && segments.length > 0) {
          contextParts.push(`\n${node.name}:`);
          segments.forEach((seg: any, idx: number) => {
            const segInfo = [
              `  Explanation ${idx + 1} (from lecture ${seg.lecture_id}):`,
              `  ${seg.text}`,
            ];
            if (seg.summary) {
              segInfo.push(`  Summary: ${seg.summary}`);
            }
            if (seg.analogies && seg.analogies.length > 0) {
              const analogyLabels = seg.analogies.map((a: any) => `"${a.label}"`).join(', ');
              segInfo.push(`  Analogies used: ${analogyLabels}`);
            }
            if (seg.style_tags && seg.style_tags.length > 0) {
              segInfo.push(`  Style: ${seg.style_tags.join(', ')}`);
            }
            contextParts.push(segInfo.join('\n'));
          });
        }
      }
      contextParts.push('');
    }
    
    // Add the relevant nodes from search
    contextParts.push('RELEVANT NODES FROM YOUR QUESTION:');
    for (const node of usedNodes) {
      const nodeInfo = [
        `Node: ${node.name}`,
        `Type: ${node.type}`,
        `Domain: ${node.domain}`,
      ];
      if (node.description) {
        nodeInfo.push(`Description: ${node.description}`);
      }
      if (node.tags && node.tags.length > 0) {
        nodeInfo.push(`Tags: ${node.tags.join(', ')}`);
      }
      const neighbors = neighborMap[node.node_id] || [];
      if (neighbors.length > 0) {
        const neighborNames = neighbors.map(n => n.name).join(', ');
        nodeInfo.push(`Connected to: ${neighborNames}`);
      }
      contextParts.push(nodeInfo.join('\n'));
    }

    const contextString = contextParts.join('\n\n');
    console.log(`[Chat API] Step 3: Built context (${contextString.length} chars)`);

    // Step 3.5: Fetch personalization data from backend
    console.log('[Chat API] Step 3.5: Fetching personalization data in parallel...');
    let styleProfile: any = null;
    let teachingStyleProfile: any = null;
    let feedbackSummary: any = null;
    let focusAreas: any[] = [];
    let userProfile: any = null;
    let exampleAnswers: Array<{ question: string; answer: string }> = [];
    let styleFeedbackExamples: string = '';
    
    // Fetch all preferences in parallel (non-blocking - failures are OK)
    const [
      styleResponse,
      teachingStyleResponse,
      feedbackResponse,
      focusResponse,
      profileResponse,
      examplesResponse,
      styleFeedbackResponse,
    ] = await Promise.allSettled([
      fetch(`${API_BASE_URL}/preferences/response-style`).catch(() => null),
      fetch(`${API_BASE_URL}/teaching-style`).catch(() => null),
      fetch(`${API_BASE_URL}/feedback/summary`).catch(() => null),
      fetch(`${API_BASE_URL}/preferences/focus-areas`).catch(() => null),
      fetch(`${API_BASE_URL}/preferences/user-profile`).catch(() => null),
      fetch(`${API_BASE_URL}/answers/examples?limit=5`).catch(() => null),
      fetch(`${API_BASE_URL}/feedback/style/examples?limit=5`).catch(() => null),
    ]);
    
    // Process responses (non-blocking, failures are OK)
    if (styleResponse.status === 'fulfilled' && styleResponse.value?.ok) {
      styleProfile = await styleResponse.value.json();
      console.log('[Chat API] Loaded response style profile');
    }
    
    if (teachingStyleResponse.status === 'fulfilled' && teachingStyleResponse.value?.ok) {
      teachingStyleProfile = await teachingStyleResponse.value.json();
      console.log('[Chat API] Loaded teaching style profile');
    }
    
    if (feedbackResponse.status === 'fulfilled' && feedbackResponse.value?.ok) {
      feedbackSummary = await feedbackResponse.value.json();
      console.log('[Chat API] Loaded feedback summary');
    }
    
    if (focusResponse.status === 'fulfilled' && focusResponse.value?.ok) {
      focusAreas = await focusResponse.value.json();
      const activeFocusAreas = focusAreas.filter((fa: any) => fa.active);
      console.log(`[Chat API] Loaded ${activeFocusAreas.length} active focus areas`);
    }
    
    if (profileResponse.status === 'fulfilled' && profileResponse.value?.ok) {
      userProfile = await profileResponse.value.json();
      console.log('[Chat API] Loaded user profile');
    }
    
    if (examplesResponse.status === 'fulfilled' && examplesResponse.value?.ok) {
      exampleAnswers = await examplesResponse.value.json();
      console.log(`[Chat API] Found ${exampleAnswers.length} example answers`);
    }
    
    if (styleFeedbackResponse.status === 'fulfilled' && styleFeedbackResponse.value?.ok) {
      try {
        const styleFeedbacks = await styleFeedbackResponse.value.json();
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
          console.log(`[Chat API] ✓ Found ${styleFeedbacks.length} style feedback example(s) - will be included in prompt`);
        }
      } catch (err) {
        console.warn('[Chat API] Failed to process style feedback examples:', err);
      }
    }

    // Step 4: Call OpenAI Chat Completions (DRAFT ANSWER)
    console.log('[Chat API] Step 4: Calling OpenAI API for draft answer...');
    const openaiStartTime = Date.now();
    
    // Build base system prompt (simpler for draft)
    const baseSystemPrompt = isGapQuestion
      ? `You are Brain Web, a learning companion that answers using ONLY the graph context provided.

IMPORTANT: This is a question about GAPS in knowledge. Your task is to:
1. Analyze what concepts EXIST in the domain (from "ALL NODES IN [DOMAIN] DOMAIN")
2. Identify what is MISSING or UNDERDEVELOPED based on standard knowledge in that field
3. Be specific about gaps - don't just list connected concepts, identify what SHOULD be there but ISN'T
4. Focus on important missing concepts, not trivial ones
5. Consider what a well-rounded knowledge of this domain should include
6. Be honest - if the domain is well-covered, say so. Don't invent gaps.

FORMATTING REQUIREMENTS:
- Use clear paragraphs separated by blank lines
- Use bullet points (- or •) for lists
- Use numbered lists for sequences
- Break up long paragraphs into shorter, readable chunks
- Use line breaks to separate major sections
- Write in a clear, academic but accessible style

Format your response as:
ANSWER: <your well-formatted answer with proper line breaks and structure>

SUGGESTED_ACTIONS: [
  {"type": "link", "source": "Concept A", "target": "Concept B", "label": "link Concept A to Concept B"},
  {"type": "add", "concept": "New Concept Name", "domain": "Domain Name", "label": "add New Concept Name to Domain Name"}
]

FOLLOW_UP_QUESTIONS: ['question1', 'question2', 'question3']`
      : isPreviousDefinitionQuestion
      ? `You are Brain Web, a teaching assistant that answers questions about how the user has previously explained concepts.

IMPORTANT: This question is asking "How have I explained this before?" or "What have I said about this previously?"

Your task:
1. Use the "HOW YOU'VE EXPLAINED THESE CONCEPTS BEFORE" section FIRST - this contains actual segments from the user's lectures
2. Reference specific explanations, analogies, and teaching styles the user has used
3. Show how their explanations evolved or varied across different lectures
4. Highlight any analogies they used (these are in the segments)
5. If they asked about multiple concepts, compare how they explained each one
6. Be specific: reference lecture IDs, segment numbers, and actual text when relevant
7. If no segments exist, fall back to the concept description

The user explains things in a grounded, intuitive way:
- They build from first principles and connect ideas to real-world workflows
- They use concrete examples (e.g., npm run dev, localhost:3000, ports 22/80)
- They explain dependencies between concepts (e.g., IDE → compiler → runtime → server → cloud)
- They avoid dramatic or exaggerated language
- They favor clear, direct sentences over academic jargon
- They sometimes use analogies but keep them simple and practical

FORMATTING REQUIREMENTS:
- Use clear paragraphs separated by blank lines
- Use bullet points (- or •) for lists
- Break up long paragraphs into shorter, readable chunks
- Use line breaks to separate major sections
- When referencing segments, be specific: "In lecture X, you explained..."

Format your response as:
ANSWER: <your well-formatted answer referencing specific segments and explanations>

SUGGESTED_ACTIONS: [
  {"type": "link", "source": "Concept A", "target": "Concept B", "label": "link Concept A to Concept B"}
]

FOLLOW_UP_QUESTIONS: ['question1', 'question2', 'question3']`
      : `You are Brain Web, a teaching assistant that speaks in the user's own style.

The user explains things in a grounded, intuitive way:

- They build from first principles and connect ideas to real-world workflows.
- They use concrete examples (e.g., npm run dev, localhost:3000, ports 22/80).
- They explain dependencies between concepts (e.g., IDE → compiler → runtime → server → cloud).
- They avoid dramatic or exaggerated language.
- They favor clear, direct sentences over academic jargon.
- They sometimes use analogies but keep them simple and practical.
- They are direct and conversational - no unnecessary transitions or formal introductions.
- They integrate analogies naturally into the flow, not as separate paragraphs.
- They use one expanded example rather than lists of examples.
- They avoid ambiguous technical terms or explain them simply.

You are given (1) a question, and (2) a set of concepts and relationships from the user's knowledge graph.

Your job:

1. Use the graph context FIRST. Prefer the user's existing concepts and descriptions over generic textbook definitions.

2. Answer in the user's style:
   - Start directly with what the concept is. No formal introductions.
   - Show how it connects to related concepts in the graph.
   - Point out prerequisites when helpful.
   - Use simple examples drawn from software engineering, web dev, data science, or everyday workflows.
   - Keep explanations focused and coherent. Be conversational, not fluffy.
   - Integrate analogies naturally - weave them in, don't break paragraphs.
   - Use one concrete example and expand it, don't list many.

3. If something is not in the graph, you may use your own knowledge, but still explain it in this same style and, when possible, connect it to nearby concepts.

4. When you mention a concept that exists in the graph, try to keep the name exactly as it appears in the graph so the frontend can highlight it. Do NOT use **bold** markdown formatting for concept names - mention them naturally without highlighting.

FORMATTING REQUIREMENTS:
- Use clear paragraphs separated by blank lines
- Use bullet points (- or •) for lists
- Break up long paragraphs into shorter, readable chunks
- Use line breaks to separate major sections
- Do NOT use **bold** markdown formatting for concepts, nodes, or section headers - mention them naturally

Format your response as:
ANSWER: <your well-formatted answer>

SUGGESTED_ACTIONS: [
  {"type": "link", "source": "Concept A", "target": "Concept B", "label": "link Concept A to Concept B"}
]

FOLLOW_UP_QUESTIONS: ['question1', 'question2', 'question3']`;
    
    // Build personalized system prompt by layering personalization features
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
      baseSystemPrompt,
      finalResponsePrefs,
      finalVoiceId,
      additionalLayers
    );
    
    // Build messages with conversation history
    const classicMessages = buildMessagesWithHistory(systemPrompt, message, contextString, chatHistory);
    
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: classicMessages,
        temperature: 0.7,
        max_tokens: maxTokens,
      }),
    });
    const openaiTime = Date.now() - openaiStartTime;
    console.log(`[Chat API] OpenAI API call took ${openaiTime}ms`);

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.json().catch(() => ({}));
      console.error(`[Chat API] OpenAI API error: ${openaiResponse.status}`, errorData);
      throw new Error(`OpenAI API error: ${openaiResponse.statusText} - ${JSON.stringify(errorData)}`);
    }

    const openaiData = await openaiResponse.json();
    const draftResponseText = openaiData.choices[0]?.message?.content || '';
    const finishReason = openaiData.choices[0]?.finish_reason;
    const wasTruncated = finishReason === 'length';
    
    if (wasTruncated) {
      console.warn(`[Chat API] Step 5: Response was truncated by token limit (finish_reason: ${finishReason})`);
    }
    console.log(`[Chat API] Step 5: Received draft response from OpenAI (${draftResponseText.length} chars)`);

    // Step 5: Parse draft response
    let draftAnswer = draftResponseText;
    let suggestedQuestions: string[] = [];
    let suggestedActions: SuggestedAction[] = [];

    // Try to extract SUGGESTED_ACTIONS first (before removing other sections)
    // NOTE: avoid the `/s` (dotAll) flag for broader TS targets
    const actionsMatch = draftResponseText.match(/SUGGESTED_ACTIONS:\s*\[([\s\S]*?)\]/);
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
      // Remove the SUGGESTED_ACTIONS section from draft answer
      draftAnswer = draftAnswer.split('SUGGESTED_ACTIONS:')[0].trim();
    }

    // Try to extract FOLLOW_UP_QUESTIONS
    const followUpMatch = draftAnswer.match(/FOLLOW_UP_QUESTIONS:\s*\[([\s\S]*?)\]/);
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
      // Remove the FOLLOW_UP_QUESTIONS section from draft answer
      draftAnswer = draftAnswer.split('FOLLOW_UP_QUESTIONS:')[0].trim();
    }

    // Remove ANSWER: prefix if present
    if (draftAnswer.startsWith('ANSWER:')) {
      draftAnswer = draftAnswer.substring(7).trim();
    }
    
    // Format draft answer with proper line breaks
    draftAnswer = draftAnswer
      .replace(/\n\n+/g, '\n\n')
      .replace(/^[-•]\s+/gm, '• ')
      .trim();

    // Step 5.5: Apply style rewrite if we have examples or style profiles
    let answer = draftAnswer;
    let rewriteApplied = false;
    const examplesUsed: Array<{ question: string; snippet: string }> = [];
    
    if (exampleAnswers.length > 0 || teachingStyleProfile || (styleProfile && styleProfile.profile)) {
      console.log('[Chat API] Step 5.5: Applying style rewrite...');
      try {
        // Build rewrite prompt with examples
        let rewritePrompt = `You are rewriting an answer to match the user's personal style.

ORIGINAL DRAFT ANSWER:
${draftAnswer}

TASK: Rewrite this answer to match the user's style more closely. Keep all the factual content, but adjust the tone, structure, and style to match the examples below.

`;
        
        if (exampleAnswers.length > 0) {
          rewritePrompt += `EXAMPLES OF THE USER'S PREFERRED STYLE:\n\n`;
          exampleAnswers.forEach((ex, idx) => {
            const snippet = ex.answer.substring(0, 200);
            examplesUsed.push({
              question: ex.question,
              snippet: snippet + (ex.answer.length > 200 ? '...' : ''),
            });
            rewritePrompt += `Example ${idx + 1}:\nQuestion: ${ex.question}\nAnswer: ${ex.answer}\n\n`;
          });
        }
        
        if (teachingStyleProfile) {
          rewritePrompt += `\nTEACHING STYLE PROFILE:\n${JSON.stringify(teachingStyleProfile, null, 2)}\n\n`;
        }
        
        if (styleProfile && styleProfile.profile) {
          rewritePrompt += `\nRESPONSE STYLE PROFILE:\nTone: ${styleProfile.profile.tone}\nTeaching style: ${styleProfile.profile.teaching_style}\nSentence structure: ${styleProfile.profile.sentence_structure}\nExplanation order: ${styleProfile.profile.explanation_order.join(' → ')}\nForbidden styles: ${styleProfile.profile.forbidden_styles.join(', ')}\n\n`;
        }
        
        rewritePrompt += `Rewrite the answer to match this style. Return ONLY the rewritten answer, no prefixes or labels.`;

        const rewriteResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'You are a style rewriter. Rewrite answers to match the user\'s preferred style while preserving all factual content. CRITICAL: Do NOT use **bold** markdown formatting for concepts, nodes, or any text. Mention concepts naturally without highlighting.',
              },
              {
                role: 'user',
                content: rewritePrompt,
              },
            ],
            temperature: 0.7,
            max_tokens: 2000, // Increased to prevent response cropping
          }),
        });

        if (rewriteResponse.ok) {
          const rewriteData = await rewriteResponse.json();
          const rewrittenText = rewriteData.choices[0]?.message?.content || '';
          if (rewrittenText.trim() && rewrittenText.trim() !== draftAnswer.trim()) {
            answer = rewrittenText.trim();
            rewriteApplied = true;
            console.log('[Chat API] Style rewrite applied successfully');
          } else {
            console.log('[Chat API] Rewrite produced same or empty answer, using draft');
          }
        } else {
          console.warn('[Chat API] Rewrite failed, using draft answer');
        }
      } catch (err) {
        console.warn('[Chat API] Error during rewrite, using draft:', err);
      }
    }
    
    // Apply post-processing guardrails (skip if already truncated by OpenAI)
    answer = enforceGuardrails(answer, finalResponsePrefs, wasTruncated);
    
    // Format final answer
    answer = answer
      .replace(/\n\n+/g, '\n\n')
      .replace(/^[-•]\s+/gm, '• ')
      // Remove bold markdown formatting (**text** becomes text)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .trim();

    // Step 6: Generate answerId and store answer
    const answerId = `answer-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
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
        } catch (err) {
          // Ignore event logging errors
        }
      } else {
        console.warn('[Chat API] Failed to store answer:', await storeResponse.text());
      }
    } catch (err) {
      console.warn('[Chat API] Error storing answer:', err);
    }
    
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

    // Build debug metadata (only in dev)
    const isDev = process.env.NODE_ENV !== 'production';
    const meta: ChatResponse['meta'] = {
      rewriteApplied,
      ...(isDev && {
        draftAnswer: draftAnswer !== answer ? draftAnswer : undefined,
        examplesUsed: examplesUsed.length > 0 ? examplesUsed : undefined,
      }),
    };

    const duration = Date.now() - startTime;
    console.log(`[Chat API] Classic mode completed in ${duration}ms`);

    // Generate answer sections for inline claim alignment
    const sections = splitAnswerIntoSections(answer);
    // Classic mode doesn't have evidence, so sections will have empty supporting_evidence_ids
    const answer_sections = mapEvidenceToSections(sections, []);

    const response: ChatResponse = {
      answer,
      usedNodes,
      suggestedQuestions: suggestedQuestions.slice(0, 3), // Limit to 3
      suggestedActions: suggestedActions.slice(0, 5), // Limit to 5 actions
      answerId,
      answer_sections,
      ...(isDev && { 
        meta: {
          ...meta,
          mode: 'classic',
          duration_ms: duration,
        }
      }),
    };

    return NextResponse.json(response);
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
 * Build messages array with conversation history for OpenAI API
 */
function buildMessagesWithHistory(
  systemPrompt: string,
  currentMessage: string,
  contextString: string,
  chatHistory?: ChatHistoryMessage[]
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

  // Add current message with context
  messages.push({
    role: 'user',
    content: `Question: ${currentMessage}

GRAPH CONTEXT:
${contextString}`,
  });

  return messages;
}

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
  focus_page_url?: string
): Promise<NextResponse> {
  const startTime = Date.now();
  try {
    // Default graph_id and branch_id if not provided
    const defaultGraphId = graph_id || 'default';
    const defaultBranchId = branch_id || 'main';

    console.log(`[Chat API] GraphRAG mode: fetching context for graph_id=${defaultGraphId}, branch_id=${defaultBranchId}, vertical=${vertical || 'general'}`);

    // Detect simple conversational queries that don't need retrieval
    const simpleConversationalPatterns = [
      /^(hi|hello|hey|sup|what's up|howdy|greetings)/i,
      /^(thanks|thank you|thx|ty)$/i,
      /^(ok|okay|sure|yep|yeah|yes|no|nope)$/i,
      /^(bye|goodbye|see you|later)$/i,
    ];
    const isSimpleConversational = simpleConversationalPatterns.some(pattern => pattern.test(message.trim()));
    
    // Use LLM to detect task creation intent intelligently (not just pattern matching)
    // This allows generalization to any natural language request
    let isTaskCreationQuery = false;
    let taskExtractionResult: any = null;
    
    try {
      // First, do a lightweight check - if message contains task-related keywords, ask LLM to confirm
      const hasTaskKeywords = /(?:task|todo|remind|schedule|need to|have to|must|should|plan to|going to)/i.test(message);
      
      if (hasTaskKeywords) {
        console.log('[Chat API] Potential task creation detected, using LLM to understand intent...');
        
        const intentPrompt = `Analyze this user message and determine if they want to CREATE a task/todo/reminder. 

Return ONLY a JSON object with this structure:
{
  "is_task_creation": true/false,
  "confidence": 0.0-1.0,
  "task_data": {
    "title": "short descriptive title" or null,
    "estimated_minutes": number or null,
    "priority": "high|medium|low" or null,
    "energy": "high|med|low" or null,
    "due_date": "YYYY-MM-DD" or null,
    "preferred_time_windows": ["morning"|"afternoon"|"evening"] or null,
    "notes": "additional context" or null
  }
}

Rules:
- is_task_creation: true ONLY if user wants to CREATE/ADD a new task (not query existing tasks, not ask about tasks)
- If false, set task_data to null
- If true, extract task details intelligently:
  * Title: extract the core action/thing to do
  * Duration: infer from context or estimate based on task type (default 60 min)
  * Priority: infer from urgency words (urgent, important, ASAP = high; normal = medium; whenever = low)
  * Energy: infer from task type (physical/active = high; mental work = med; routine = low)
  * Due date: extract if "tomorrow", "today", or specific date mentioned
  * Preferred time: extract if morning/afternoon/evening mentioned

User message: "${message}"

Return ONLY the JSON object:`;

        const intentResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are a helpful assistant that understands user intent. Return only valid JSON.' },
              { role: 'user', content: intentPrompt }
            ],
            temperature: 0.2,
            max_tokens: 300,
          }),
        });

        if (intentResponse.ok) {
          const intentData = await intentResponse.json();
          const intentText = intentData.choices[0]?.message?.content?.trim() || '';
          
          try {
            const jsonMatch = intentText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              isTaskCreationQuery = parsed.is_task_creation === true && parsed.confidence > 0.5;
              taskExtractionResult = parsed.task_data;
              console.log(`[Chat API] LLM intent analysis: is_task_creation=${isTaskCreationQuery}, confidence=${parsed.confidence}`);
            }
          } catch {
            console.error('[Chat API] Failed to parse LLM intent response:', intentText);
          }
        }
      }
    } catch (err) {
      console.error('[Chat API] Error in LLM intent detection:', err);
      // Fall back to simple pattern matching if LLM fails
      const fallbackPatterns = [
        /create.*task/i,
        /add.*task/i,
        /new.*task/i,
      ];
      isTaskCreationQuery = fallbackPatterns.some(pattern => pattern.test(message));
    }
    
    // Use LLM to detect itinerary/planning intent intelligently
    let isItineraryQuery = false;
    let itineraryDateInfo: { target_date: string | null; is_tomorrow: boolean; is_today: boolean } | null = null;
    
    try {
      // Lightweight check for planning-related keywords
      const hasPlanningKeywords = /(?:plan|schedule|itinerary|agenda|calendar|what.*doing|what.*on|show.*schedule|generate.*schedule|tomorrow|today)/i.test(message);
      
      if (hasPlanningKeywords && !isTaskCreationQuery) {
        console.log('[Chat API] Potential itinerary query detected, using LLM to understand intent...');
        
        const itineraryIntentPrompt = `Analyze this user message and determine if they want to VIEW/GET their schedule/itinerary/plan for a specific day.

Return ONLY a JSON object with this structure:
{
  "is_itinerary_query": true/false,
  "confidence": 0.0-1.0,
  "date_info": {
    "target_date": "YYYY-MM-DD" or null,
    "is_tomorrow": true/false,
    "is_today": true/false,
    "is_specific_date": true/false
  }
}

Rules:
- is_itinerary_query: true if user wants to SEE/VIEW/GET their schedule/plan/itinerary (not create tasks, not ask general questions)
- Examples of itinerary queries: "what's my plan tomorrow", "show my schedule", "what am I doing today", "plan my day", "generate schedule"
- Examples of NOT itinerary: "create a task", "what is machine learning", general questions
- Extract date info: determine if they're asking about tomorrow, today, or a specific date
- If no date mentioned, assume they want today's schedule

User message: "${message}"

Return ONLY the JSON object:`;

        const itineraryIntentResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'You are a helpful assistant that understands user intent. Return only valid JSON.' },
              { role: 'user', content: itineraryIntentPrompt }
            ],
            temperature: 0.2,
            max_tokens: 200,
          }),
        });

        if (itineraryIntentResponse.ok) {
          const itineraryIntentData = await itineraryIntentResponse.json();
          const itineraryIntentText = itineraryIntentData.choices[0]?.message?.content?.trim() || '';
          
          try {
            const jsonMatch = itineraryIntentText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              isItineraryQuery = parsed.is_itinerary_query === true && parsed.confidence > 0.5;
              itineraryDateInfo = parsed.date_info || null;
              console.log(`[Chat API] LLM itinerary analysis: is_itinerary_query=${isItineraryQuery}, confidence=${parsed.confidence}, date_info=${JSON.stringify(itineraryDateInfo)}`);
            }
          } catch {
            console.error('[Chat API] Failed to parse LLM itinerary intent response:', itineraryIntentText);
          }
        }
      }
    } catch (err) {
      console.error('[Chat API] Error in LLM itinerary intent detection:', err);
      // Fall back to simple pattern matching if LLM fails
      const fallbackPatterns = [
        /what.*(my|your).*(plan|schedule|itinerary)/i,
        /plan.*(my|your).*day/i,
        /show.*schedule/i,
      ];
      isItineraryQuery = fallbackPatterns.some(pattern => pattern.test(message));
    }
    
    console.log(`[Chat API] Task creation check: "${message.substring(0, 50)}" -> ${isTaskCreationQuery}`);
    console.log(`[Chat API] Itinerary query check: "${message.substring(0, 50)}" -> ${isItineraryQuery}`);
    if (isItineraryQuery) {
      console.log(`[Chat API] ⚠️ ITINERARY QUERY DETECTED via LLM - will call scheduler API`);
    }
    
    // Handle task creation queries first - use LLM-extracted data
    if (isTaskCreationQuery && !isItineraryQuery && taskExtractionResult) {
      try {
        console.log('[Chat API] ✓ Detected task creation query via LLM, creating task...');
        
        // Validate LLM-extracted task data
        if (!taskExtractionResult.title || taskExtractionResult.title.length < 3) {
          return NextResponse.json({
            answer: "I understood you want to create a task, but I couldn't extract what task you'd like to create. Could you rephrase it? For example:\n\n\"Create a task: Review Q4 reports, 2 hours, high priority, due tomorrow\"\n\nor\n\n\"I need to go to the hospital tomorrow\"",
            usedNodes: [],
            suggestedQuestions: [
              "Create a task: Review reports, 2 hours, high priority, due tomorrow",
              "What's my plan tomorrow?",
              "Show me my calendar events"
            ],
          });
        }
        
        // Prepare task payload with LLM-extracted data and defaults
        const taskPayload: any = {
          title: taskExtractionResult.title,
          estimated_minutes: taskExtractionResult.estimated_minutes || 60,
          priority: taskExtractionResult.priority || 'medium',
          energy: taskExtractionResult.energy || 'med',
        };
        
        if (taskExtractionResult.due_date) {
          taskPayload.due_date = taskExtractionResult.due_date;
        }
        if (taskExtractionResult.preferred_time_windows && taskExtractionResult.preferred_time_windows.length > 0) {
          taskPayload.preferred_time_windows = taskExtractionResult.preferred_time_windows;
        }
        
        console.log(`[Chat API] Creating task from LLM extraction:`, taskPayload);
        
        // Create the task via API
        const createTaskResponse = await fetch(
          `${API_BASE_URL}/tasks`,
          {
            method: 'POST',
            headers: getBackendHeaders(),
            body: JSON.stringify(taskPayload),
          }
        );
        
        if (createTaskResponse.ok) {
          const createdTask = await createTaskResponse.json();
          console.log(`[Chat API] ✓ Created task: ${createdTask.id}`);
          
          let responseText = `✓ I've created a task: **${createdTask.title}**\n`;
          responseText += `  • Duration: ${createdTask.estimated_minutes} minutes\n`;
          responseText += `  • Priority: ${createdTask.priority}\n`;
          responseText += `  • Energy level: ${createdTask.energy}\n`;
          if (createdTask.due_date) {
            responseText += `  • Due: ${createdTask.due_date}\n`;
          }
          if (createdTask.preferred_time_windows && createdTask.preferred_time_windows.length > 0) {
            responseText += `  • Preferred time: ${createdTask.preferred_time_windows.join(', ')}\n`;
          }
          
          const hasDueDate = createdTask.due_date;
          const isTomorrow = hasDueDate && createdTask.due_date === new Date(Date.now() + 86400000).toISOString().split('T')[0];
          const isToday = hasDueDate && createdTask.due_date === new Date().toISOString().split('T')[0];
          
          if (hasDueDate && (isTomorrow || isToday)) {
            responseText += `\nWould you like me to plan your ${isTomorrow ? 'tomorrow' : 'today'} and schedule this task?`;
          } else {
            responseText += `\nWould you like me to help you plan when to do this task?`;
          }
          
          return NextResponse.json({
            answer: responseText,
            usedNodes: [],
            suggestedQuestions: [
              hasDueDate && isTomorrow ? "What's my plan tomorrow?" : hasDueDate && isToday ? "What's my plan today?" : "What's my plan tomorrow?",
              "Show me my calendar events",
              "Create another task"
            ],
            createdTask: createdTask, // Include task data for frontend
          });
        } else {
          const errorText = await createTaskResponse.text().catch(() => 'Unknown error');
          console.error(`[Chat API] Failed to create task: ${createTaskResponse.status} - ${errorText}`);
          
          return NextResponse.json({
            answer: `I had trouble creating that task. The error was: ${errorText}. Please try again or create the task manually.`,
            usedNodes: [],
            suggestedQuestions: [
              "What's my plan tomorrow?",
              "Show me my calendar events"
            ],
          });
        }
      } catch (err) {
        console.error('[Chat API] Error handling task creation:', err);
        // Fall through to normal processing - let GraphRAG handle it
      }
    }
    
    // Handle itinerary queries by calling scheduler API - use LLM-extracted date info
    if (isItineraryQuery) {
      try {
        console.log('[Chat API] ✓ Detected itinerary query via LLM, calling scheduler API...');
        
        // Use LLM-extracted date info, with fallback to pattern matching
        let targetDate = new Date();
        let isTomorrow = false;
        let isToday = false;
        
        if (itineraryDateInfo) {
          isTomorrow = itineraryDateInfo.is_tomorrow === true;
          isToday = itineraryDateInfo.is_today === true;
          
          if (itineraryDateInfo.target_date) {
            // Use specific date from LLM
            targetDate = new Date(itineraryDateInfo.target_date);
            console.log(`[Chat API] Using LLM-extracted date: ${itineraryDateInfo.target_date}`);
          } else if (isTomorrow) {
            targetDate.setDate(targetDate.getDate() + 1);
            console.log(`[Chat API] LLM detected: tomorrow (${targetDate.toISOString().split('T')[0]})`);
          } else if (isToday) {
            console.log(`[Chat API] LLM detected: today (${targetDate.toISOString().split('T')[0]})`);
          } else {
            // Default to today if no date info
            console.log(`[Chat API] No date info from LLM, defaulting to today`);
          }
        } else {
          // Fallback to pattern matching if LLM didn't extract date info
          isTomorrow = /tomorrow/i.test(message);
          isToday = /today/i.test(message);
          
          if (isTomorrow) {
            targetDate.setDate(targetDate.getDate() + 1);
            console.log(`[Chat API] Fallback pattern match: tomorrow (${targetDate.toISOString().split('T')[0]})`);
          } else if (isToday) {
            console.log(`[Chat API] Fallback pattern match: today (${targetDate.toISOString().split('T')[0]})`);
          }
        }
        
        // Set working hours in local timezone (8 AM - 10 PM)
        const startDate = new Date(targetDate);
        startDate.setHours(8, 0, 0, 0); // 8 AM local time
        const endDate = new Date(targetDate);
        endDate.setHours(22, 0, 0, 0); // 10 PM local time
        
        // Convert to ISO strings (will include timezone offset)
        const startISO = startDate.toISOString();
        const endISO = endDate.toISOString();
        
        console.log(`[Chat API] Date range: ${startISO} to ${endISO} (local time: ${startDate.toLocaleTimeString()} - ${endDate.toLocaleTimeString()})`);
        
        console.log(`[Chat API] Calling scheduler API: ${startISO} to ${endISO}`);
        
        // Call scheduler API to get suggestions
        const schedulerResponse = await fetch(
          `${API_BASE_URL}/schedule/suggestions?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`,
          {
            method: 'POST',
            headers: getBackendHeaders(),
          }
        );
        
        console.log(`[Chat API] Scheduler API response status: ${schedulerResponse.status}`);
        
        if (schedulerResponse.ok) {
          const suggestionsData = await schedulerResponse.json();
          const suggestions = suggestionsData.suggestions || [];
          const groupedByDay = suggestionsData.grouped_by_day || {};
          
          console.log(`[Chat API] Scheduler returned ${suggestions.length} suggestions`);
          
          if (suggestions.length === 0) {
            // No suggestions - check if there are tasks
            const targetDateStr = targetDate.toISOString().split('T')[0];
            console.log(`[Chat API] No suggestions, checking for tasks with due_date: ${targetDateStr}`);
            
            const tasksResponse = await fetch(
              `${API_BASE_URL}/tasks?range=7`,
              { headers: getBackendHeaders() }
            );
            
            if (tasksResponse.ok) {
              const tasksData = await tasksResponse.json();
              const tasks = tasksData.tasks || [];
              console.log(`[Chat API] Found ${tasks.length} total tasks`);
              
              const relevantTasks = tasks.filter((t: any) => {
                if (!t.due_date) {
                  console.log(`[Chat API] Task "${t.title}" has no due_date`);
                  return false;
                }
                // Compare date strings directly (YYYY-MM-DD format)
                const taskDateStr = typeof t.due_date === 'string' 
                  ? t.due_date.split('T')[0]  // Handle ISO datetime strings
                  : t.due_date;
                const matches = taskDateStr === targetDateStr;
                if (matches) {
                  console.log(`[Chat API] ✓ Found matching task: ${t.title} (due: ${t.due_date})`);
                } else {
                  console.log(`[Chat API] Task "${t.title}" due_date "${t.due_date}" doesn't match "${targetDateStr}"`);
                }
                return matches;
              });
              
              console.log(`[Chat API] Found ${relevantTasks.length} tasks for target date`);
              
              if (relevantTasks.length === 0) {
                // Check calendar events too
                const calendarResponse = await fetch(
                  `${API_BASE_URL}/calendar/events?start_date=${targetDate.toISOString().split('T')[0]}&end_date=${targetDate.toISOString().split('T')[0]}`,
                  { headers: getBackendHeaders() }
                ).catch(() => null);
                
                let calendarInfo = '';
                if (calendarResponse?.ok) {
                  const calendarData = await calendarResponse.json();
                  const events = calendarData.events || [];
                  if (events.length > 0) {
                    calendarInfo = `\n\nI see you have ${events.length} calendar event${events.length > 1 ? 's' : ''} scheduled:\n${events.slice(0, 3).map((e: any) => `- ${e.title}${e.start_time ? ` at ${e.start_time.substring(0, 5)}` : ''}`).join('\n')}${events.length > 3 ? `\n... and ${events.length - 3} more` : ''}`;
                  }
                }
                
                return NextResponse.json({
                  answer: `I don't see any tasks scheduled for ${isTomorrow ? 'tomorrow' : isToday ? 'today' : 'that date'}.${calendarInfo}\n\nWould you like me to help you create some tasks? You can say something like:\n- "Create a task: Review Q4 reports, 2 hours, high priority, due tomorrow"\n- "I need to prepare a presentation tomorrow, it will take 2 hours"`,
                  usedNodes: [],
                  suggestedQuestions: [
                    "Create a task: Review reports, 2 hours, high priority, due tomorrow",
                    "Show me my calendar events",
                    "What tasks do I have this week?"
                  ],
                });
              } else {
                return NextResponse.json({
                  answer: `I found ${relevantTasks.length} task${relevantTasks.length > 1 ? 's' : ''} for ${isTomorrow ? 'tomorrow' : isToday ? 'today' : 'that date'}, but I wasn't able to generate schedule suggestions. This might be because your calendar is fully booked or there are no suitable time slots. Here are your tasks:\n\n${relevantTasks.map((t: any) => `- ${t.title} (${t.estimated_minutes} min, ${t.priority} priority)`).join('\n')}\n\nWould you like me to help you manually schedule these?`,
                  usedNodes: [],
                  suggestedQuestions: [
                    "Show me my calendar events",
                    "Create a new task",
                    "What are my free time blocks?"
                  ],
                });
              }
            }
            
            return NextResponse.json({
              answer: `I don't see any schedule suggestions for ${isTomorrow ? 'tomorrow' : isToday ? 'today' : 'that date'}. You might want to create some tasks first, or check if your calendar has available time slots.`,
              usedNodes: [],
              suggestedQuestions: [
                "Create a task for tomorrow",
                "Show me my calendar events",
                "What are my free time blocks?"
              ],
            });
          }
          
          // Format suggestions into a readable response
          const dateStr = targetDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
          let answer = `Here's your suggested schedule for ${dateStr}:\n\n`;
          
          // Group by time
          const sortedSuggestions = [...suggestions].sort((a, b) => 
            new Date(a.start).getTime() - new Date(b.start).getTime()
          );
          
          for (const sug of sortedSuggestions) {
            const startTime = new Date(sug.start);
            const endTime = new Date(sug.end);
            const timeStr = `${startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${endTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
            
            answer += `📅 **${sug.task_title}**\n`;
            answer += `   Time: ${timeStr}\n`;
            answer += `   Confidence: ${Math.round(sug.confidence * 100)}%\n`;
            if (sug.reasons && sug.reasons.length > 0) {
              answer += `   Reasons:\n`;
              for (const reason of sug.reasons) {
                answer += `   • ${reason}\n`;
              }
            }
            answer += `\n`;
          }
          
          answer += `\nThese suggestions are based on your tasks, calendar events, and preferences. You can accept or modify them as needed.`;
          
          return NextResponse.json({
            answer,
            usedNodes: [],
            suggestedQuestions: [
              "Show me my calendar events",
              "Create a new task",
              "What are my free time blocks?",
              "Update a task"
            ],
            scheduleSuggestions: suggestions, // Include raw data for frontend
          });
        } else {
          const errorText = await schedulerResponse.text().catch(() => 'Unknown error');
          console.warn(`[Chat API] Scheduler API failed: ${schedulerResponse.status} - ${errorText}`);
          
          // Even if scheduler fails, try to get tasks and calendar events to give helpful response
          try {
            const tasksResponse = await fetch(
              `${API_BASE_URL}/tasks?range=7`,
              { headers: getBackendHeaders() }
            );
            
            if (tasksResponse.ok) {
              const tasksData = await tasksResponse.json();
              const tasks = tasksData.tasks || [];
              const relevantTasks = tasks.filter((t: any) => {
                if (!t.due_date) return false;
                const dueDate = new Date(t.due_date);
                return dueDate.toDateString() === targetDate.toDateString();
              });
              
              if (relevantTasks.length > 0) {
                return NextResponse.json({
                  answer: `I found ${relevantTasks.length} task${relevantTasks.length > 1 ? 's' : ''} for ${isTomorrow ? 'tomorrow' : isToday ? 'today' : 'that date'}, but I'm having trouble generating schedule suggestions right now. Here are your tasks:\n\n${relevantTasks.map((t: any) => `- ${t.title} (${t.estimated_minutes} min, ${t.priority} priority)`).join('\n')}\n\nYou can view your calendar events in the calendar widget on the right.`,
                  usedNodes: [],
                  suggestedQuestions: [
                    "Show me my calendar events",
                    "Create a new task",
                    "What are my free time blocks?"
                  ],
                });
              }
            }
          } catch (taskErr) {
            console.error('[Chat API] Error fetching tasks:', taskErr);
          }
          
          // Fall through to normal processing if we can't help
        }
      } catch (err) {
        console.error('[Chat API] Error handling itinerary query:', err);
        console.error('[Chat API] Error stack:', err instanceof Error ? err.stack : 'No stack');
        // Fall through to normal processing
      }
    }
    
    let retrievalData: any = null;
    let intent = 'DEFINITION_OVERVIEW';
    let trace: any[] = [];
    let context: any = {};
    let styleFeedbackResponse: PromiseSettledResult<Response | null>;
    
    // Only fetch retrieval for non-conversational queries, with timeout
    const retrievalStartTime = Date.now();
    let retrievalLatency = 0;
    if (!isSimpleConversational) {
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
      ];
      
      // Add lecture mentions fetch in parallel if lecture_id exists
      let lectureMentionsPromise: Promise<Response | null> | null = null;
      if (lecture_id) {
        lectureMentionsPromise = fetch(`${API_BASE_URL}/lectures/${lecture_id}/mentions`, {
          headers: getBackendHeaders(),
        }).catch(() => null);
        parallelFetches.push(lectureMentionsPromise);
      }
      
      const [retrievalResponse, styleFeedbackResponseResult] = await Promise.allSettled(parallelFetches);
      
      // Store style feedback response for later processing  
      styleFeedbackResponse = styleFeedbackResponseResult;

      // Process retrieval response
      if (retrievalResponse.status === 'fulfilled' && retrievalResponse.value) {
        const retrievalResult = retrievalResponse.value;
        if (retrievalResult.ok) {
          try {
            retrievalData = await retrievalResult.json();
            intent = retrievalData.intent || 'DEFINITION_OVERVIEW';
            trace = retrievalData.trace || [];
            context = retrievalData.context || {};
            console.log(`[Chat API] Intent: ${intent}, Trace steps: ${trace.length}`);
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
      // Fetch style feedback separately for conversational queries
      const styleFeedbackResult = await Promise.allSettled([
        fetch(`${API_BASE_URL}/feedback/style/examples?limit=5`).catch(() => null)
      ]);
      styleFeedbackResponse = styleFeedbackResult[0];
    }
    retrievalLatency = Date.now() - retrievalStartTime;
    
    // Build context text from structured context (empty if skipped retrieval)
    const contextResult = buildContextTextFromStructured(context, intent);
    const contextText = contextResult.text;
    const printedClaims = contextResult.printedClaims;
    const printedQuotes = contextResult.printedQuotes;
    const printedSources = contextResult.printedSources;

    let lectureContext = '';
    if (lecture_id) {
      try {
        const mentionsResponse = await fetch(`${API_BASE_URL}/lectures/${lecture_id}/mentions`, {
          headers: getBackendHeaders(),
        });
        if (mentionsResponse.ok) {
          const mentions = await mentionsResponse.json();
          if (mentions && mentions.length > 0) {
            const conceptMap = new Map<string, { concept: any; mentions: any[] }>();
            mentions.forEach((mention: any) => {
              const conceptId = mention.concept?.node_id || mention.concept_id;
              if (!conceptId || !mention.concept) {
                return;
              }
              if (!conceptMap.has(conceptId)) {
                conceptMap.set(conceptId, { concept: mention.concept, mentions: [] });
              }
              conceptMap.get(conceptId)!.mentions.push(mention);
            });

            const grouped = Array.from(conceptMap.values()).slice(0, 8);
            const lectureParts: string[] = ['## Linked Concepts in This Lecture'];
            grouped.forEach((group) => {
              lectureParts.push(`\n${group.concept.name}`);
              if (group.concept.description) {
                lectureParts.push(`Definition: ${group.concept.description}`);
              }
              const mentionNotes = group.mentions
                .map((m: any) => m.context_note)
                .filter((note: string | null) => !!note)
                .slice(0, 2);
              if (mentionNotes.length > 0) {
                lectureParts.push(`Context notes: ${mentionNotes.join(' | ')}`);
              }
            });

            lectureContext = lectureParts.join('\n');
          }
        }
      } catch (err) {
        console.warn('[Chat API] Failed to fetch lecture mentions for context:', err);
      }
    }

    const combinedContextText = lectureContext ? `${contextText}\n\n${lectureContext}` : contextText;
    
    console.log(`[Chat API] Context retrieved (${combinedContextText.length} chars)`);
    
    // Phase A: Build evidence ID allowlist for strict mode
    const allowedClaimIds = printedClaims;
    const allowedQuoteIds = printedQuotes;
    const allowedSourceUrls = printedSources;
    
    // Build allowlist block for prompt
    let allowlistBlock = '';
    if (evidence_strictness === 'high' && (allowedClaimIds.length > 0 || allowedQuoteIds.length > 0 || allowedSourceUrls.length > 0)) {
      allowlistBlock = '\n\n## Allowed Evidence IDs (must only cite these)\n';
      if (allowedClaimIds.length > 0) {
        allowlistBlock += `- Allowed Claim IDs: ${allowedClaimIds.join(', ')}\n`;
      }
      if (allowedQuoteIds.length > 0) {
        allowlistBlock += `- Allowed Quote IDs: ${allowedQuoteIds.join(', ')}\n`;
      }
      if (allowedSourceUrls.length > 0) {
        allowlistBlock += `- Allowed Source URLs: ${allowedSourceUrls.join(', ')}\n`;
      }
      allowlistBlock += '\nYou may ONLY cite evidence IDs/URLs that appear in the Allowed Evidence IDs list above.';
    }
    
    // If context is empty or very minimal, add a note to the prompt
    const contextNote = combinedContextText.trim().length === 0 
      ? "\n\nNOTE: No GraphRAG context was found for this query. You can still respond naturally using your general knowledge."
      : "";

    // Process style feedback response (already fetched in parallel)
    let styleFeedbackExamples: string = '';
    if (styleFeedbackResponse.status === 'fulfilled' && styleFeedbackResponse.value) {
      try {
        const response = styleFeedbackResponse.value;
        if (response.ok) {
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
          } else {
            console.log('[Chat API] No style feedback examples found yet');
          }
        }
      } catch (err) {
        console.warn('[Chat API] Failed to process style feedback examples:', err);
      }
    }

    // Build base system prompt for GraphRAG
    const strictnessNote = evidence_strictness === 'high' 
      ? '\n\nCRITICAL CITATION REQUIREMENTS (evidence_strictness=high):\n- Any factual assertion MUST include at least one citation token: [Quote: ...] OR [Claim: ...] OR [Source: ...]\n- If evidence is insufficient, say "Not enough evidence in your graph yet" and ask what to capture next.\n- Do not use general world knowledge unless explicitly labeled "General knowledge (uncited)" and only for background definitions.\n- Every sentence with verbs like "is/was/causes/leads to/results in/means" must cite evidence.\n'
      : evidence_strictness === 'medium'
      ? '\n\nCITATION GUIDELINES (evidence_strictness=medium):\n- Prefer citing evidence when available: [Quote: ...], [Claim: ...], or [Source: ...]\n- You may use general knowledge but prefer graph evidence when present.\n'
      : '';
    
    const baseSystemPrompt = `You are Brain Web, a teaching assistant and conversational agent.

When GraphRAG context is provided:
- Use the GraphRAG context to answer the question
- Cite specific claims and sources when relevant using citation tokens: [Quote: QUOTE_ID], [Claim: CLAIM_ID], [Source: URL]
- Reference communities when discussing related concepts
- Be specific and traceable to the provided evidence

When GraphRAG context is empty or minimal:
- You can still have a normal conversation
- Answer questions using your general knowledge
- Be helpful and conversational
- Don't require specific graph context to respond
- If the user is just chatting or asking general questions, respond naturally

CITATION TOKEN RULES:
- Any factual assertion MUST include at least one of: [Quote: ...] OR [Claim: ...] OR [Source: ...]
- If evidence is insufficient, say "Not enough evidence in your graph yet" and ask for what to capture next.
- Use exact IDs from the context (quote_id, claim_id, source URLs)
- You may ONLY cite evidence IDs/URLs that appear in the Allowed Evidence IDs list (if provided)${strictnessNote}

CRITICAL: Honesty and Specificity
- When asked about specific real-world entities (movies, TV shows, books, people, companies, events, etc.), be SPECIFIC and FACTUAL
- If you don't know specific details about a particular entity, say so clearly: "I don't have specific information about [entity]" or "I'm not certain about the details of [entity]"
- DO NOT make up generic, vague descriptions that could apply to anything
- DO NOT invent cast members, plot details, or facts you're uncertain about
- If asked about something you're unsure of, admit uncertainty rather than providing generic information
- When you do know something, be specific: mention actual names, dates, events, and concrete details
- Example of BAD response: "The cast features talented actors who bring depth to their roles" (too vague)
- Example of GOOD response: "I don't have specific information about the cast of that film. Could you clarify which film you're referring to, or would you like me to search for more details?"

The context provided includes:
- Session Context (trail summary + focus context)
- Supporting Quotes with IDs: [Quote: QUOTE_ID]
- Supporting Claims with IDs: [Claim: CLAIM_ID]
- Relevant communities of related concepts
- Relevant concepts and their relationships

Your task:
1. If context is available, use it to answer the question
2. If context is minimal or empty, respond naturally using your knowledge BUT be honest about uncertainty
3. Cite specific claims and sources when relevant using citation tokens (if available)
4. Reference communities when discussing related concepts (if available) - mention them naturally without using **bold** markdown formatting
5. Be conversational and helpful, but NEVER make up specific facts about real-world entities
6. When uncertain, admit it clearly rather than providing generic information

FORMATTING REQUIREMENTS:
- Use clear paragraphs separated by blank lines
- Use bullet points (- or •) for lists
- Break up long paragraphs into shorter, readable chunks
- Use line breaks to separate major sections
- Do NOT use **bold** markdown formatting for concepts, nodes, or section headers - mention them naturally

Format your response as:
ANSWER: <your well-formatted answer>

SUGGESTED_ACTIONS: [
  {"type": "link", "source": "Concept A", "target": "Concept B", "label": "link Concept A to Concept B"},
  {"type": "add", "concept": "New Concept Name", "domain": "Domain Name", "label": "add New Concept Name to Domain Name"}
]

FOLLOW_UP_QUESTIONS: ['question1', 'question2', 'question3']

CRITICAL ACTION HANDLING:
- When the user asks to "add [X] to graph", "create a node for [X]", "add [X] as a node", etc., they want ACTION, not explanation.
- When the user asks to "link [X] to [Y]", "connect [X] and [Y]", etc., they want the RELATIONSHIP CREATED, not just explained.
- For action requests, keep your ANSWER brief (1-2 sentences max) and ALWAYS include the action in SUGGESTED_ACTIONS.
- Only provide detailed explanations if the user explicitly asks "explain [X]" or "what is [X]".
- Action request examples:
  * "add TSMC to graph" → Brief: "Adding TSMC to the graph." + SUGGESTED_ACTIONS: [{"type": "add", "concept": "TSMC", "domain": "Technology", "label": "add TSMC to Technology"}]
  * "create a node for NVIDIA" → Brief: "Creating NVIDIA node." + SUGGESTED_ACTIONS: [{"type": "add", "concept": "NVIDIA", "domain": "Technology", "label": "add NVIDIA to Technology"}]
  * "link TSMC to NVDA" → Brief: "Linking TSMC to NVDA." + SUGGESTED_ACTIONS: [{"type": "link", "source": "TSMC", "target": "NVDA", "label": "link TSMC to NVDA"}]
  * "connect X and Y" → Brief: "Connecting X and Y." + SUGGESTED_ACTIONS: [{"type": "link", "source": "X", "target": "Y", "label": "link X to Y"}]
- IMPORTANT: For "link" requests, use exact concept names as they appear in the graph (case-sensitive matching).
- If user asks "explain TSMC" or "what is TSMC", THEN provide detailed explanation without actions.`;

    // Default ResponsePreferences if not provided
    const defaultResponsePrefs: ResponsePreferences = {
      mode: 'compact',
      ask_question_policy: 'at_most_one',
      end_with_next_step: true,
    };
    const finalResponsePrefs: ResponsePreferences = { ...defaultResponsePrefs, ...(responsePrefs || {}) };
    const finalVoiceId = voiceId || 'neutral';

    // Build additional layers for personalization (including style feedback)
    const additionalLayers: string[] = [];
    
    // Add style feedback examples if available
    if (styleFeedbackExamples) {
      const styleFeedbackLayer = `

RECENT STYLE FEEDBACK EXAMPLES (learn from these patterns):
${styleFeedbackExamples}

Use these examples to refine your responses. Pay attention to what the user liked and disliked. Match the style of responses they approved of.
`;
      additionalLayers.push(styleFeedbackLayer);
    }

    // Use PromptBuilder to compose system prompt with response preferences and style feedback
    const { systemPrompt, maxTokens } = buildPrompt(
      baseSystemPrompt,
      finalResponsePrefs,
      finalVoiceId,
      additionalLayers
    );

    // Build messages with conversation history
    const contextString = (combinedContextText || '(No specific context found - feel free to respond naturally)') + contextNote + allowlistBlock;
    const messages = buildMessagesWithHistory(systemPrompt, message, contextString, chatHistory);

    // Call OpenAI with GraphRAG context
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
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

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.json().catch(() => ({}));
      console.error(`[Chat API] OpenAI API error: ${openaiResponse.status}`, errorData);
      throw new Error(`OpenAI API error: ${openaiResponse.statusText}`);
    }

    const openaiData = await openaiResponse.json();
    let responseText = openaiData.choices[0]?.message?.content || '';
    const finishReason = openaiData.choices[0]?.finish_reason;

    // Check if response was truncated by token limit
    if (finishReason === 'length') {
      console.warn('[Chat API] Response was truncated due to token limit. Consider increasing max_tokens.');
    }

    // Phase B & C: Citation verification and strictness validation for 'high' mode
    if (evidence_strictness === 'high') {
      // Phase B: Parse and verify citation tokens
      const citationTokens = parseCitationTokens(responseText);
      const allowlists = {
        claims: allowedClaimIds,
        quotes: allowedQuoteIds,
        sources: allowedSourceUrls,
      };
      
      const verification = verifyCitationTokens(citationTokens, allowlists);
      const strictnessCheck = checkStrictnessValidation(responseText);
      
      let needsRegeneration = false;
      let regenerationReason = '';
      
      if (!verification.ok) {
        needsRegeneration = true;
        const invalidParts: string[] = [];
        if (verification.invalid.claims.length > 0) {
          invalidParts.push(`invalid claim IDs: ${verification.invalid.claims.join(', ')}`);
        }
        if (verification.invalid.quotes.length > 0) {
          invalidParts.push(`invalid quote IDs: ${verification.invalid.quotes.join(', ')}`);
        }
        if (verification.invalid.sources.length > 0) {
          invalidParts.push(`invalid source URLs: ${verification.invalid.sources.join(', ')}`);
        }
        regenerationReason = `Your previous answer cited IDs not present in the allowlist: ${invalidParts.join('; ')}. Only cite allowed IDs from the Allowed Evidence IDs list.`;
      }
      
      if (!strictnessCheck.passes) {
        needsRegeneration = true;
        regenerationReason = regenerationReason || `In strict mode, include citations inline frequently. ${strictnessCheck.reason || 'If you cannot cite, say you lack evidence.'}`;
      }
      
      if (needsRegeneration) {
        console.log('[Chat API] High strictness: Validation failed, regenerating...', { verification, strictnessCheck });
        
        // Regenerate once with stricter reminder
        const stricterPrompt = systemPrompt + '\n\nCRITICAL REMINDER: ' + regenerationReason;
        
        try {
          const regenerateResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: messages.map((m, idx) => idx === 0 ? { ...m, content: stricterPrompt } : m),
              temperature: 0.7,
              max_tokens: maxTokens,
            }),
          });
          
          if (regenerateResponse.ok) {
            const regenerateData = await regenerateResponse.json();
            const regeneratedText = regenerateData.choices[0]?.message?.content || '';
            
            // Verify again
            const newTokens = parseCitationTokens(regeneratedText);
            const newVerification = verifyCitationTokens(newTokens, allowlists);
            const newStrictnessCheck = checkStrictnessValidation(regeneratedText);
            
            if (!newVerification.ok || !newStrictnessCheck.passes) {
              // Still has issues, prepend warning
              responseText = '⚠️ Warning: Some citations could not be verified against your graph evidence.\n\n' + regeneratedText;
              // Store invalid tokens in trace for debugging (non-user visible)
              console.warn('[Chat API] Regenerated answer still has validation issues:', {
                invalid: newVerification.invalid,
                strictness: newStrictnessCheck,
              });
            } else {
              responseText = regeneratedText;
            }
          }
        } catch (err) {
          console.warn('[Chat API] Failed to regenerate with stricter prompt:', err);
          // Prepend warning to original response
          responseText = '⚠️ Warning: Some citations could not be verified against your graph evidence.\n\n' + responseText;
        }
      }
    }

    // Parse response (similar to classic mode)
    let answer = responseText;
    
    // If response was truncated, don't apply aggressive guardrails
    const wasTruncated = finishReason === 'length';
    let suggestedQuestions: string[] = [];
    let suggestedActions: SuggestedAction[] = [];

    // Extract SUGGESTED_ACTIONS - improved parsing
    const actionsMatch = responseText.match(/SUGGESTED_ACTIONS:\s*(\[[\s\S]*?\])/);
    if (actionsMatch) {
      try {
        const actionsJson = actionsMatch[1];
        // Try to parse the JSON array directly
        suggestedActions = JSON.parse(actionsJson);
        console.log(`[Chat API] Parsed ${suggestedActions.length} suggested actions:`, suggestedActions);
        answer = answer.split('SUGGESTED_ACTIONS:')[0].trim();
      } catch (err) {
        console.warn('[Chat API] Failed to parse suggested actions:', err);
        console.warn('[Chat API] Actions string:', actionsMatch[1]);
        // Try alternative parsing - extract individual action objects
        try {
          const actionObjects = actionsMatch[1].match(/\{[^}]*"type"[^}]*\}/g);
          if (actionObjects) {
            suggestedActions = actionObjects.map((obj: string) => {
              try {
                return JSON.parse(obj);
              } catch {
                return null;
              }
            }).filter(Boolean) as SuggestedAction[];
            console.log(`[Chat API] Parsed ${suggestedActions.length} actions using fallback method`);
          }
        } catch (fallbackErr) {
          console.warn('[Chat API] Fallback parsing also failed:', fallbackErr);
        }
        answer = answer.split('SUGGESTED_ACTIONS:')[0].trim();
      }
    } else {
      // Check if actions might be in a different format
      console.log('[Chat API] No SUGGESTED_ACTIONS found in response');
      console.log('[Chat API] Response preview:', responseText.substring(0, 500));
    }

    // Extract FOLLOW_UP_QUESTIONS
    const followUpMatch = answer.match(/FOLLOW_UP_QUESTIONS:\s*\[([\s\S]*?)\]/);
    if (followUpMatch) {
      try {
        const questionsStr = followUpMatch[1];
        const questionMatches = (questionsStr.match(/'([^']+)'/g) || questionsStr.match(/"([^"]+)"/g)) as string[] | null;
        if (questionMatches) {
          suggestedQuestions = questionMatches.map((q: string) => q.slice(1, -1));
        }
        answer = answer.split('FOLLOW_UP_QUESTIONS:')[0].trim();
      } catch (err) {
        console.warn('[Chat API] Failed to parse follow-up questions:', err);
      }
    }

    // Remove ANSWER: prefix if present
    if (answer.startsWith('ANSWER:')) {
      answer = answer.substring(7).trim();
    }

    // Auto-execute "link" actions when user explicitly asks to link nodes
    // Check if message is a clear link request (e.g., "link X to Y", "connect X and Y")
    const linkPattern = /link\s+(\w+)\s+to\s+(\w+)|connect\s+(\w+)\s+(?:and|to)\s+(\w+)|link\s+(\w+)\s+and\s+(\w+)/i;
    const linkMatch = message.match(linkPattern);
    const isExplicitLinkRequest = linkMatch !== null;
    
    // Auto-execute link actions if:
    // 1. User explicitly asked to link (pattern match), OR
    // 2. There's a "link" action in suggestedActions and message contains "link"
    const linkAction = suggestedActions.find(a => a.type === 'link' && a.source && a.target);
    if (linkAction && (isExplicitLinkRequest || message.toLowerCase().includes('link'))) {
      try {
        console.log('[Chat API] Auto-executing link action:', linkAction);
        
        // Resolve concept names to node_ids
        const resolveConcept = async (name: string): Promise<string | null> => {
          try {
            // First try to find in the graph context
            const contextConcept = context.focus_entities?.find((e: any) => 
              e.name.toLowerCase() === name.toLowerCase()
            );
            if (contextConcept) {
              return contextConcept.node_id;
            }
            
            // If not in context, search for it
            const searchResponse = await fetch(
              `${API_BASE_URL}/concepts/search?q=${encodeURIComponent(name)}&limit=5${graph_id ? `&graph_id=${graph_id}` : ''}`,
              { method: 'GET' }
            );
            if (searchResponse.ok) {
              const searchData = await searchResponse.json();
              // Search endpoint returns { results: Concept[], count: number }
              const exactMatch = searchData.results?.find((c: Concept) => 
                c.name.toLowerCase() === name.toLowerCase()
              );
              if (exactMatch) {
                return exactMatch.node_id;
              }
            }
            return null;
          } catch (err) {
            console.warn(`[Chat API] Failed to resolve concept "${name}":`, err);
            return null;
          }
        };
        
        const sourceId = await resolveConcept(linkAction.source!);
        const targetId = await resolveConcept(linkAction.target!);
        
        if (sourceId && targetId) {
          // Create the relationship
          const relationshipResponse = await fetch(
            `${API_BASE_URL}/concepts/relationship-by-ids?source_id=${sourceId}&target_id=${targetId}&predicate=RELATED_TO`,
            { method: 'POST' }
          );
          
          if (relationshipResponse.ok) {
            // Update answer to confirm the link was created
            answer = `✅ Linked "${linkAction.source}" to "${linkAction.target}" successfully!\n\n${answer}`;
            // Remove the link action from suggestedActions since it's already executed
            suggestedActions = suggestedActions.filter(a => !(a.type === 'link' && a.source === linkAction.source && a.target === linkAction.target));
            console.log('[Chat API] Successfully auto-executed link action');
          } else {
            const errorText = await relationshipResponse.text();
            console.warn('[Chat API] Failed to create relationship:', errorText);
            answer = `⚠️ Could not create link: ${errorText}\n\n${answer}`;
          }
        } else {
          const missing = [];
          if (!sourceId) missing.push(linkAction.source);
          if (!targetId) missing.push(linkAction.target);
          console.warn(`[Chat API] Could not find concepts: ${missing.join(', ')}`);
          answer = `⚠️ Could not find concept(s): ${missing.join(', ')}. Make sure they exist in the graph.\n\n${answer}`;
        }
      } catch (err) {
        console.error('[Chat API] Error auto-executing link action:', err);
        // Don't fail the whole request - just log and continue
      }
    }

    // Apply post-processing guardrails (skip if already truncated by OpenAI)
    answer = enforceGuardrails(answer, finalResponsePrefs, wasTruncated);
    
    // Format answer
    answer = answer
      .replace(/\n\n+/g, '\n\n')
      .replace(/^[-•]\s+/gm, '• ')
      // Remove bold markdown formatting (**text** becomes text)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .trim();

    // Generate answerId
    const answerId = `answer-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Store answer (optional - could extract used concepts from GraphRAG debug info)
    try {
      const storeResponse = await fetch(`${API_BASE_URL}/answers/store`, {
        method: 'POST',
        headers: getBackendHeaders(),
          body: JSON.stringify({
            answer_id: answerId,
            question: message,
            raw_answer: answer,
            used_node_ids: context.focus_entities?.map((e: any) => e.node_id) || [],
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
              payload: { conceptIdsUsed: context.focus_entities?.map((e: any) => e.node_id) || [] },
            }),
          }).catch(() => {}); // Swallow errors
        } catch (err) {
          // Ignore event logging errors
        }
      } else {
        console.warn('[Chat API] Failed to store answer:', await storeResponse.text());
      }
    } catch (err) {
      console.warn('[Chat API] Error storing answer:', err);
    }

    // Extract retrieval metadata for display
    // Use retrieval_meta from backend if available (summary mode), otherwise compute
    const backendMeta = context.retrieval_meta;
    const retrievalMeta = backendMeta ? {
      communities: backendMeta.communities || 0,
      claims: backendMeta.claims || 0,
      concepts: backendMeta.concepts || 0,
      edges: backendMeta.edges || 0,
      sourceBreakdown: backendMeta.sourceBreakdown || {},
      claimIds: backendMeta.claimIds || [],
      communityIds: backendMeta.communityIds || [],
      topClaims: backendMeta.topClaims || [], // Include claim previews
      intent: intent,
      traceSteps: trace.length,
    } : {
      communities: context.focus_communities?.length || 0,
      claims: context.claims?.length || 0,
      concepts: context.focus_entities?.length || 0,
      edges: context.subgraph?.edges?.length || 0,
      sourceBreakdown: {},
      claimIds: context.claims?.map((c: any) => c.claim_id) || [],
      communityIds: context.focus_communities?.map((c: any) => c.community_id) || [],
      topClaims: context.top_claims || context.claims?.slice(0, 5) || [], // Fallback to claims if available
      intent: intent,
      traceSteps: trace.length,
    };

    // Convert focus_entities to Concept format for usedNodes
    const usedNodes: Concept[] = (context.focus_entities || []).map((e: any) => ({
      node_id: e.node_id,
      name: e.name,
      domain: e.domain || '',
      type: e.type || 'concept',
      description: e.description,
      tags: e.tags,
    }));

    // Extract suggestions from context if available
    const contextSuggestions = context.suggestions || [];
    const suggestedQuestionsFromContext = contextSuggestions.map((s: any) => s.query || s.label).slice(0, 3);
    
    const duration = Date.now() - startTime;
    
    // Extract evidence_used from context
    const evidenceUsed: EvidenceItem[] = context.evidence_used || [];

    // Phase E: Populate meta.trace from retrievalData + session/focus contexts
    const traceIds = context.trace_ids || {};
    const sessionContext = context.session_context || {};
    
    // Build used_trail_steps from session_context
    const usedTrailSteps = (sessionContext.steps || []).map((s: any) => ({
      step_id: s.step_id,
      kind: s.kind,
      ref_id: s.ref_id,
      title: s.title,
      created_at: s.created_at,
    }));
    
    // Build used_sources from evidence_used
    const usedSources = evidenceUsed.map(e => ({
      title: e.title,
      url: e.url || undefined,
    })).filter(s => s.title || s.url);
    
    // Phase D: Add printed_* fields to trace for consistency
    const metaTrace = {
      used_trail_steps: usedTrailSteps,
      used_concepts: traceIds.used_concept_ids || [],
      used_quotes: traceIds.used_quote_ids || [],
      used_claims: traceIds.used_claim_ids || [],
      used_sources: usedSources,
      printed_quotes: printedQuotes,
      printed_claims: printedClaims,
      printed_sources: printedSources,
      retrieval_plan: retrievalData?.plan_version || 'intent_plans_v1',
      retrieval_latency_ms: retrievalLatency || 0,
      evidence_strictness: evidence_strictness || 'medium',
    };

    // Generate answer sections for inline claim alignment
    const sections = splitAnswerIntoSections(answer);
    const answer_sections = mapEvidenceToSections(sections, evidenceUsed);

    // Debug: Log the answer before returning
    console.log('[Chat API] Final answer length:', answer.length);
    console.log('[Chat API] Final answer preview:', answer.substring(0, 200));
    
    // CRITICAL: Ensure answer is not empty - if it is, use a fallback
    if (!answer || answer.trim() === '') {
      console.error('[Chat API] ⚠️ WARNING: Answer is empty after processing! Using fallback.');
      answer = "I'm sorry, I encountered an issue generating a response. Please try rephrasing your question.";
    }
    
    const response: ChatResponse = {
      answer: answer.trim(), // Ensure answer is trimmed and not empty
      usedNodes: usedNodes,
      suggestedQuestions: suggestedQuestionsFromContext.length > 0 ? suggestedQuestionsFromContext : suggestedQuestions.slice(0, 3),
      suggestedActions: suggestedActions.slice(0, 5),
      answerId,
      retrievalMeta, // Add retrieval metadata
      evidenceUsed: evidenceUsed.length > 0 ? evidenceUsed : undefined,
      answer_sections,
      meta: {
        mode: 'graphrag',
        rewriteApplied: false,
        duration_ms: duration,
        intent: intent,
        traceSteps: trace.length,
        trace: metaTrace,
      },
    };

    console.log('[Chat API] Returning response with answer length:', response.answer.length);
    console.log('[Chat API] Response keys:', Object.keys(response));
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
function buildContextTextFromStructured(context: any, intent: string): {
  text: string;
  printedClaims: string[];
  printedQuotes: string[];
  printedSources: string[];
} {
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
    const quotesToPrint = allQuotes.slice(0, 10);
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
    for (const comm of context.focus_communities.slice(0, 3)) {
      parts.push(`\n### ${comm.name || comm.community_id}`);
      // Summary mode: no long summary text, just names
    }
    parts.push("");
  }
  
  // Add concepts section (summary mode: max 5, no descriptions)
  if (context.focus_entities && context.focus_entities.length > 0) {
    parts.push("## Relevant Concepts");
    for (const concept of context.focus_entities.slice(0, 5)) {
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
  if (intent === 'TIMELINE' && context.timeline_items) {
    parts.push("## Timeline");
    for (const item of context.timeline_items.slice(0, 15)) {
      parts.push(`\n[${item.date || 'unknown'}] ${item.text}`);
    }
    parts.push("");
  }
  
  if (intent === 'CAUSAL_CHAIN' && context.causal_paths) {
    parts.push("## Causal Paths");
    for (const path of context.causal_paths.slice(0, 3)) {
      parts.push(`\nPath with ${path.nodes?.length || 0} nodes, ${path.edges?.length || 0} edges`);
      if (path.supporting_claim_ids) {
        parts.push(`Supported by ${path.supporting_claim_ids.length} claims`);
      }
    }
    parts.push("");
  }
  
  if (intent === 'COMPARE' && context.compare) {
    parts.push("## Comparison");
    parts.push(`\nComparing: ${context.compare.A?.name || 'A'} vs ${context.compare.B?.name || 'B'}`);
    if (context.compare.overlaps?.shared_concepts) {
      parts.push(`\nShared concepts: ${context.compare.overlaps.shared_concepts.length}`);
    }
    parts.push("");
  }
  
  if (intent === 'EVIDENCE_CHECK' && context.evidence) {
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
