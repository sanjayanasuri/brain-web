import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

// In Next.js, environment variables without NEXT_PUBLIC_ prefix are only available server-side
// OPENAI_API_KEY should be in .env.local (not .env.local.public)
// Note: Next.js caches env vars at build time, so restart dev server after changing .env.local

function getOpenAIApiKey(): string | undefined {
  // Try to read directly from .env.local file as a fallback
  let key = process.env.OPENAI_API_KEY;
  
  // If key is too short or missing, try reading from file directly
  if (!key || key.length < 20) {
    try {
      const fs = require('fs');
      const path = require('path');
      const envPath = path.join(process.cwd(), '.env.local');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/^OPENAI_API_KEY=(.+)$/m);
        if (match && match[1]) {
          key = match[1].trim();
          console.log('[Chat API] Read API key directly from .env.local file');
        }
      }
    } catch (err) {
      console.warn('[Chat API] Could not read .env.local directly:', err);
    }
  }
  
  if (!key) {
    console.error('[Chat API] OPENAI_API_KEY not found in environment variables');
    console.error('[Chat API] Make sure you have OPENAI_API_KEY in frontend/.env.local');
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

interface ChatRequest {
  message: string;
}

interface SuggestedAction {
  type: 'link' | 'add';
  source?: string;
  target?: string;
  concept?: string;
  domain?: string;
  label: string;
}

interface ChatResponse {
  answer: string;
  usedNodes: Concept[];
  suggestedQuestions: string[];
  suggestedActions?: SuggestedAction[];
  answerId?: string;
  meta?: {
    draftAnswer?: string;
    rewriteApplied: boolean;
    examplesUsed?: Array<{
      question: string;
      snippet: string;
    }>;
  };
}

export async function POST(request: NextRequest) {
  try {
    // Get API key at request time (not module load time) to ensure fresh value
    const apiKey = getOpenAIApiKey();
    
    const body: ChatRequest = await request.json();
    const { message } = body;

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

    console.log(`[Chat API] Processing question: "${message.substring(0, 50)}..."`);

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

    // Step 4: Call OpenAI Chat Completions (DRAFT ANSWER)
    console.log('[Chat API] Step 4: Calling OpenAI API for draft answer...');
    const startTime = Date.now();
    
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

The user is Sanjay, who explains things in a grounded, intuitive way:
- He builds from first principles and connects ideas to real-world workflows
- He uses concrete examples (e.g., npm run dev, localhost:3000, ports 22/80)
- He explains dependencies between concepts (e.g., IDE → compiler → runtime → server → cloud)
- He avoids dramatic or exaggerated language
- He favors clear, direct sentences over academic jargon
- He sometimes uses analogies but keeps them simple and practical

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

The user is Sanjay, who explains things in a grounded, intuitive way:

- He builds from first principles and connects ideas to real-world workflows.
- He uses concrete examples (e.g., npm run dev, localhost:3000, ports 22/80).
- He explains dependencies between concepts (e.g., IDE → compiler → runtime → server → cloud).
- He avoids dramatic or exaggerated language.
- He favors clear, direct sentences over academic jargon.
- He sometimes uses analogies but keeps them simple and practical.

You are given (1) a question, and (2) a set of concepts and relationships from the user's knowledge graph.

Your job:

1. Use the graph context FIRST. Prefer the user's existing concepts and descriptions over generic textbook definitions.

2. Answer in Sanjay's style:
   - Start from what the concept is.
   - Then show how it connects to related concepts in the graph.
   - Point out prerequisites when helpful.
   - Use simple examples drawn from software engineering, web dev, data science, or everyday workflows.
   - Keep explanations focused and coherent. It's okay to be conversational, but do not be fluffy.

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
    let systemPrompt = baseSystemPrompt;
    
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
      systemPrompt = systemPrompt + teachingStyleInstructions;
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
      systemPrompt = systemPrompt + styleInstructions;
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
      systemPrompt = systemPrompt + feedbackInstructions;
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
      systemPrompt = systemPrompt + focusInstructions;
    }
    
    // Layer 4: User Profile
    if (userProfile) {
      const profileInstructions = `

User profile:
- Name: ${userProfile.name}
- Background: ${userProfile.background.join(', ') || 'none specified'}
- Interests: ${userProfile.interests.join(', ') || 'none specified'}
- Weak spots: ${userProfile.weak_spots.join(', ') || 'none specified'}
- Learning preferences: ${JSON.stringify(userProfile.learning_preferences)}

When explaining:
- Avoid re-explaining fundamentals in areas of strong background unless asked.
- Pay extra attention to weak spots; build bridges from known background.
- Use analogies and layered explanations if preferred.
`;
      systemPrompt = systemPrompt + profileInstructions;
    }
    
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
        max_tokens: 800, // Increased for better formatted responses
      }),
    });
    const openaiTime = Date.now() - startTime;
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
      if (!storeResponse.ok) {
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

    const response: ChatResponse = {
      answer,
      usedNodes,
      suggestedQuestions: suggestedQuestions.slice(0, 3), // Limit to 3
      suggestedActions: suggestedActions.slice(0, 5), // Limit to 5 actions
      answerId,
      ...(isDev && { meta }),
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

