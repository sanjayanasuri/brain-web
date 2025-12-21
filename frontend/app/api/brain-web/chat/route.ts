import { NextRequest, NextResponse } from 'next/server';

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
      const fs = require('fs');
      const path = require('path');
      
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

interface ChatRequest {
  message: string;
  mode?: 'classic' | 'graphrag';
  graph_id?: string;
  branch_id?: string;
  vertical?: 'general' | 'finance';
  lens?: string;
  recency_days?: number;
  evidence_strictness?: 'high' | 'medium' | 'low';
  include_proposed_edges?: boolean;
  response_prefs?: ResponsePreferences;
  voice_id?: string;
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
  const maxTokens = prefs.max_output_tokens || (
    prefs.mode === 'compact' ? 150 :
    prefs.mode === 'hint' ? 100 :
    prefs.mode === 'deep' ? 1200 :
    800 // normal
  );

  return { systemPrompt, maxTokens };
}

/**
 * Post-processing guardrails to enforce response preferences
 */
function enforceGuardrails(
  answer: string,
  responsePrefs: ResponsePreferences
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

  // Enforce compact mode: limit length
  if (prefs.mode === 'compact') {
    const lines = processed.split('\n');
    if (lines.length > 3) {
      processed = lines.slice(0, 3).join('\n');
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
    let { message, mode = 'graphrag', graph_id, branch_id, vertical, lens, recency_days, evidence_strictness, include_proposed_edges, response_prefs, voice_id } = body;
    
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
      const result = await handleGraphRAGMode(message, graph_id, branch_id, apiKey, vertical, lens, recency_days, evidence_strictness, include_proposed_edges, finalResponsePrefs, finalVoiceId);
      const totalDuration = Date.now() - startTime;
      console.log(`[Chat API] GraphRAG mode completed in ${totalDuration}ms`);
      return result; // handleGraphRAGMode already includes metrics
    }

    // Classic mode (existing flow)
    // Step 1: Call semantic search
    console.log(`[Chat API] Step 1: Calling semantic search at ${API_BASE_URL}/ai/semantic-search`);
    const searchResponse = await fetch(`${API_BASE_URL}/ai/semantic-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    // Check if this is a "gaps" question - if so, get ALL nodes in the domain
    const isGapQuestion = /gap|missing|what.*don.*know|what.*need.*learn|what.*should.*study/i.test(message);
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

    // Step 2: Check if this is asking about previous definitions/explanations
    const isPreviousDefinitionQuestion = /how.*(have|did).*you.*(previously|before|earlier|in the past).*(define|explain|describe|say about)|what.*(have|did).*you.*(previously|before|earlier).*(say|explain|define|describe).*about/i.test(message);
    
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
    let contextParts: string[] = [];
    
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
    console.log('[Chat API] Step 3.5: Fetching personalization data...');
    let styleProfile: any = null;
    let teachingStyleProfile: any = null;
    let feedbackSummary: any = null;
    let focusAreas: any[] = [];
    let userProfile: any = null;
    
    try {
      // Fetch response style profile
      const styleResponse = await fetch(`${API_BASE_URL}/preferences/response-style`);
      if (styleResponse.ok) {
        styleProfile = await styleResponse.json();
        console.log('[Chat API] Loaded response style profile');
      }
    } catch (err) {
      console.warn('[Chat API] Failed to fetch style profile:', err);
    }
    
    try {
      // Fetch teaching style profile
      const teachingStyleResponse = await fetch(`${API_BASE_URL}/teaching-style`);
      if (teachingStyleResponse.ok) {
        teachingStyleProfile = await teachingStyleResponse.json();
        console.log('[Chat API] Loaded teaching style profile');
      }
    } catch (err) {
      console.warn('[Chat API] Failed to fetch teaching style profile:', err);
    }
    
    try {
      // Fetch feedback summary
      const feedbackResponse = await fetch(`${API_BASE_URL}/feedback/summary`);
      if (feedbackResponse.ok) {
        feedbackSummary = await feedbackResponse.json();
        console.log('[Chat API] Loaded feedback summary');
      }
    } catch (err) {
      console.warn('[Chat API] Failed to fetch feedback summary:', err);
    }
    
    try {
      // Fetch focus areas
      const focusResponse = await fetch(`${API_BASE_URL}/preferences/focus-areas`);
      if (focusResponse.ok) {
        focusAreas = await focusResponse.json();
        const activeFocusAreas = focusAreas.filter((fa: any) => fa.active);
        console.log(`[Chat API] Loaded ${activeFocusAreas.length} active focus areas`);
      }
    } catch (err) {
      console.warn('[Chat API] Failed to fetch focus areas:', err);
    }
    
    try {
      // Fetch user profile
      const profileResponse = await fetch(`${API_BASE_URL}/preferences/user-profile`);
      if (profileResponse.ok) {
        userProfile = await profileResponse.json();
        console.log('[Chat API] Loaded user profile');
      }
    } catch (err) {
      console.warn('[Chat API] Failed to fetch user profile:', err);
    }

    // Step 3.6: Fetch example answers from revisions (for style rewrite)
    console.log('[Chat API] Step 3.6: Fetching example answers from revisions...');
    let exampleAnswers: Array<{ question: string; answer: string }> = [];
    try {
      const examplesResponse = await fetch(`${API_BASE_URL}/answers/examples?limit=5`);
      if (examplesResponse.ok) {
        exampleAnswers = await examplesResponse.json();
        console.log(`[Chat API] Found ${exampleAnswers.length} example answers`);
      }
    } catch (err) {
      console.warn('[Chat API] Failed to fetch example answers:', err);
    }
    
    // Step 3.7: Fetch style feedback examples (for style learning)
    console.log('[Chat API] Step 3.7: Fetching style feedback examples...');
    let styleFeedbackExamples: string = '';
    try {
      const styleFeedbackResponse = await fetch(`${API_BASE_URL}/feedback/style/examples?limit=5`);
      if (styleFeedbackResponse.ok) {
        const styleFeedbacks = await styleFeedbackResponse.json();
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
        } else {
          console.log('[Chat API] No style feedback examples found yet');
        }
      } else {
        console.warn(`[Chat API] Style feedback endpoint returned ${styleFeedbackResponse.status}`);
      }
    } catch (err) {
      console.warn('[Chat API] Failed to fetch style feedback examples:', err);
      console.warn('[Chat API] This is OK if no feedback has been submitted yet');
    }

    // Step 4: Call OpenAI Chat Completions (DRAFT ANSWER)
    console.log('[Chat API] Step 4: Calling OpenAI API for draft answer...');
    const openaiStartTime = Date.now();
    
    // Build base system prompt (simpler for draft)
    let baseSystemPrompt = isGapQuestion
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

4. When you mention a concept that exists in the graph, try to keep the name exactly as it appears in the graph so the frontend can highlight it.

FORMATTING REQUIREMENTS:
- Use clear paragraphs separated by blank lines
- Use bullet points (- or •) for lists
- Break up long paragraphs into shorter, readable chunks
- Use line breaks to separate major sections

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
    
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
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
            content: systemPrompt,
          },
          {
            role: 'user',
            content: `Question: ${message}

GRAPH CONTEXT:
${contextString}`,
          },
        ],
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
                content: 'You are a style rewriter. Rewrite answers to match the user\'s preferred style while preserving all factual content.',
              },
              {
                role: 'user',
                content: rewritePrompt,
              },
            ],
            temperature: 0.7,
            max_tokens: 800,
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
    
    // Apply post-processing guardrails
    answer = enforceGuardrails(answer, finalResponsePrefs);
    
    // Format final answer
    answer = answer
      .replace(/\n\n+/g, '\n\n')
      .replace(/^[-•]\s+/gm, '• ')
      .trim();

    // Step 6: Generate answerId and store answer
    const answerId = `answer-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    // Store answer in backend
    try {
      const storeResponse = await fetch(`${API_BASE_URL}/answers/store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
            headers: { 'Content-Type': 'application/json' },
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
      const gapResponse = await fetch(`${API_BASE_URL}/concepts/gaps?limit=3`);
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

async function handleGraphRAGMode(
  message: string,
  graph_id: string | undefined,
  branch_id: string | undefined,
  apiKey: string,
  vertical?: 'general' | 'finance',
  lens?: string,
  recency_days?: number,
  evidence_strictness?: 'high' | 'medium' | 'low',
  include_proposed_edges?: boolean,
  responsePrefs?: ResponsePreferences,
  voiceId?: string
): Promise<NextResponse> {
  const startTime = Date.now();
  try {
    // Default graph_id and branch_id if not provided
    const defaultGraphId = graph_id || 'default';
    const defaultBranchId = branch_id || 'main';

    console.log(`[Chat API] GraphRAG mode: fetching context for graph_id=${defaultGraphId}, branch_id=${defaultBranchId}, vertical=${vertical || 'general'}`);

    // Build request body for intent-based retrieval
    const requestBody: any = {
      message,
      mode: 'graphrag',
      limit: 5,
      graph_id: defaultGraphId,
      branch_id: defaultBranchId,
      detail_level: 'summary', // Request summary mode for progressive disclosure
    };
    
    // Note: For now, we use intent-based retrieval. Vertical-specific params can be added later if needed.
    // The intent router will automatically classify the query.

    // Call intent-based retrieval endpoint
    let retrievalResponse;
    try {
      retrievalResponse = await fetch(`${API_BASE_URL}/ai/retrieve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
    } catch (fetchError: any) {
      console.error(`[Chat API] Fetch error connecting to backend: ${fetchError.message}`);
      console.error(`[Chat API] Backend URL: ${API_BASE_URL}/ai/retrieve`);
      console.error(`[Chat API] Make sure backend is running on ${API_BASE_URL}`);
      throw new Error(`Backend connection failed: ${fetchError.message}. Is the backend running on ${API_BASE_URL}?`);
    }

    if (!retrievalResponse.ok) {
      const errorText = await retrievalResponse.text();
      console.error(`[Chat API] Retrieval failed: ${retrievalResponse.status} ${errorText}`);
      throw new Error(`Retrieval failed: ${retrievalResponse.status} ${errorText}`);
    }

    const retrievalData = await retrievalResponse.json();
    const intent = retrievalData.intent;
    const trace = retrievalData.trace || [];
    const context = retrievalData.context || {};
    
    console.log(`[Chat API] Intent: ${intent}, Trace steps: ${trace.length}`);
    
    // Build context text from structured context
    const contextText = buildContextTextFromStructured(context, intent);
    
    console.log(`[Chat API] Context retrieved (${contextText.length} chars)`);

    // Build base system prompt for GraphRAG
    const baseSystemPrompt = `You are Brain Web, a teaching assistant that answers questions using GraphRAG context.

The context provided includes:
- Relevant communities of related concepts
- Supporting claims with evidence
- Relevant concepts and their relationships

Your task:
1. Use the GraphRAG context to answer the question
2. Cite specific claims and sources when relevant
3. Reference communities when discussing related concepts
4. Be specific and traceable to the provided evidence

FORMATTING REQUIREMENTS:
- Use clear paragraphs separated by blank lines
- Use bullet points (- or •) for lists
- Break up long paragraphs into shorter, readable chunks
- Use line breaks to separate major sections

Format your response as:
ANSWER: <your well-formatted answer>

SUGGESTED_ACTIONS: [
  {"type": "link", "source": "Concept A", "target": "Concept B", "label": "link Concept A to Concept B"}
]

FOLLOW_UP_QUESTIONS: ['question1', 'question2', 'question3']`;

    // Default ResponsePreferences if not provided
    const defaultResponsePrefs: ResponsePreferences = {
      mode: 'compact',
      ask_question_policy: 'at_most_one',
      end_with_next_step: true,
    };
    const finalResponsePrefs: ResponsePreferences = { ...defaultResponsePrefs, ...(responsePrefs || {}) };
    const finalVoiceId = voiceId || 'neutral';

    // Use PromptBuilder to compose system prompt with response preferences
    const { systemPrompt, maxTokens } = buildPrompt(
      baseSystemPrompt,
      finalResponsePrefs,
      finalVoiceId
    );

    // Call OpenAI with GraphRAG context
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: `Question: ${message}

GRAPH CONTEXT:
${contextText}`,
          },
        ],
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
    const responseText = openaiData.choices[0]?.message?.content || '';

    // Parse response (similar to classic mode)
    let answer = responseText;
    let suggestedQuestions: string[] = [];
    let suggestedActions: SuggestedAction[] = [];

    // Extract SUGGESTED_ACTIONS
    const actionsMatch = responseText.match(/SUGGESTED_ACTIONS:\s*\[([\s\S]*?)\]/);
    if (actionsMatch) {
      try {
        const actionsStr = actionsMatch[1];
        const jsonArrayMatch = actionsStr.match(/\[([\s\S]*?)\]/);
        if (jsonArrayMatch) {
          const actionsJson = '[' + jsonArrayMatch[1] + ']';
          suggestedActions = JSON.parse(actionsJson);
        }
        answer = answer.split('SUGGESTED_ACTIONS:')[0].trim();
      } catch (err) {
        console.warn('[Chat API] Failed to parse suggested actions:', err);
      }
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

    // Apply post-processing guardrails
    answer = enforceGuardrails(answer, finalResponsePrefs);
    
    // Format answer
    answer = answer
      .replace(/\n\n+/g, '\n\n')
      .replace(/^[-•]\s+/gm, '• ')
      .trim();

    // Generate answerId
    const answerId = `answer-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Store answer (optional - could extract used concepts from GraphRAG debug info)
    try {
      const storeResponse = await fetch(`${API_BASE_URL}/answers/store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
            headers: { 'Content-Type': 'application/json' },
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
    const isDev = process.env.NODE_ENV !== 'production';
    
    // Extract evidence_used from context
    const evidenceUsed: EvidenceItem[] = context.evidence_used || [];

    // Generate answer sections for inline claim alignment
    const sections = splitAnswerIntoSections(answer);
    const answer_sections = mapEvidenceToSections(sections, evidenceUsed);

    const response: ChatResponse = {
      answer,
      usedNodes: usedNodes,
      suggestedQuestions: suggestedQuestionsFromContext.length > 0 ? suggestedQuestionsFromContext : suggestedQuestions.slice(0, 3),
      suggestedActions: suggestedActions.slice(0, 5),
      answerId,
      retrievalMeta, // Add retrieval metadata
      evidenceUsed: evidenceUsed.length > 0 ? evidenceUsed : undefined,
      answer_sections,
      ...(isDev && {
        meta: {
          mode: 'graphrag',
          duration_ms: duration,
          intent: intent,
          traceSteps: trace.length,
        },
      }),
    };

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
 * Build context text from structured context payload.
 */
function buildContextTextFromStructured(context: any, intent: string): string {
  const parts: string[] = [];
  
  // Add communities section (summary mode: names only, max 3, no summaries)
  if (context.focus_communities && context.focus_communities.length > 0) {
    parts.push("## Community Summaries (Global Memory)");
    for (const comm of context.focus_communities.slice(0, 3)) {
      parts.push(`\n### ${comm.name || comm.community_id}`);
      // Summary mode: no long summary text, just names
    }
    parts.push("");
  }
  
  // Add claims section (summary mode: max 5, already trimmed)
  if (context.claims && context.claims.length > 0) {
    parts.push("## Supporting Claims");
    for (const claim of context.claims.slice(0, 5)) {
      parts.push(`\n- ${claim.text} (confidence: ${(claim.confidence || 0.5).toFixed(2)})`);
      if (claim.source_id) {
        parts.push(`  Source: ${claim.source_id}`);
      }
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
  
  return parts.join("\n");
}

