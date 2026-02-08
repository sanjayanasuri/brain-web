/**
 * AI-First Agent System for Brain Web
 * 
 * Targeted agents for quality, accuracy, and truth-grounded responses.
 * All agents use LLMs - no rule-based logic.
 */

export interface AgentResult<T = any> {
  success: boolean;
  score: number; // 0-1 quality score
  feedback: string[];
  data?: T;
  confidence: number; // 0-1 confidence in the result
}

export interface FactCheckResult extends AgentResult {
  verifiedClaims: string[];
  unverifiedClaims: string[];
  contradictions: Array<{ claim: string; reason: string }>;
}

export interface CoherenceResult extends AgentResult {
  issues: Array<{ section: string; issue: string; severity: 'low' | 'medium' | 'high' }>;
  flowScore: number; // 0-1
}

export interface ValidationResult extends AgentResult {
  citationIssues: Array<{ citation: string; issue: string }>;
  completenessScore: number; // 0-1
  accuracyScore: number; // 0-1
}

export interface SummarizationResult extends AgentResult {
  summary: string;
  keyPoints: string[];
}

/**
 * Multi-model strategy: Use appropriate model for each task
 */
export const MODEL_STRATEGY = {
  // Fast, cheap models for drafts and simple tasks
  DRAFT: 'gpt-4o-mini',
  INTENT: 'gpt-4o-mini',
  ROUTING: 'gpt-4o-mini',

  // High-quality models for critical validation
  FACT_CHECK: 'gpt-4o',
  VALIDATION: 'gpt-4o',
  COHERENCE: 'gpt-4o',

  // Medium quality for refinement
  REFINEMENT: 'gpt-4o-mini',
  SUMMARIZATION: 'gpt-4o-mini',
} as const;

/**
 * Fact Checker Agent
 * Verifies all claims in response against the knowledge graph evidence
 */
export async function factCheckerAgent(
  response: string,
  context: {
    claims: Array<{ claim_id: string; text: string; evidence?: any }>;
    quotes: Array<{ quote_id: string; text: string }>;
    sources: Array<{ url: string; title?: string }>;
  },
  apiKey: string
): Promise<FactCheckResult> {
  const prompt = `You are a fact-checker. Verify every factual claim in this response against the provided evidence.

RESPONSE TO CHECK:
${response}

AVAILABLE EVIDENCE:
Claims: ${JSON.stringify(context.claims.slice(0, 20), null, 2)}
Quotes: ${JSON.stringify(context.quotes.slice(0, 20), null, 2)}
Sources: ${JSON.stringify(context.sources.slice(0, 10), null, 2)}

Return ONLY a JSON object with this structure:
{
  "verifiedClaims": ["list of claims that are supported by evidence"],
  "unverifiedClaims": ["list of claims that cannot be verified"],
  "contradictions": [{"claim": "text", "reason": "why it contradicts evidence"}],
  "score": 0.0-1.0,
  "confidence": 0.0-1.0,
  "feedback": ["specific issues found"]
}

Rules:
- A claim is verified if it's directly supported by evidence
- A claim is unverified if there's no evidence (not necessarily wrong, just unverifiable)
- A claim contradicts if it directly conflicts with evidence
- Score: 1.0 = all claims verified, 0.0 = major contradictions
- Be strict: if evidence is insufficient, mark as unverified`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_STRATEGY.FACT_CHECK,
        messages: [
          { role: 'system', content: 'You are a rigorous fact-checker. Return only valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`Fact check failed: ${response.statusText}`);
    }

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);

    return {
      success: result.score >= 0.7,
      score: result.score,
      confidence: result.confidence,
      feedback: result.feedback || [],
      verifiedClaims: result.verifiedClaims || [],
      unverifiedClaims: result.unverifiedClaims || [],
      contradictions: result.contradictions || [],
    };
  } catch (error) {
    console.error('[FactChecker] Error:', error);
    return {
      success: false,
      score: 0,
      confidence: 0,
      feedback: [`Fact check failed: ${error}`],
      verifiedClaims: [],
      unverifiedClaims: [],
      contradictions: [],
    };
  }
}

/**
 * Coherence Checker Agent
 * Ensures logical flow, consistency, and readability
 */
export async function coherenceCheckerAgent(
  response: string,
  question: string,
  apiKey: string
): Promise<CoherenceResult> {
  const prompt = `Analyze the coherence, logical flow, and consistency of this response.

QUESTION:
${question}

RESPONSE:
${response}

Return ONLY a JSON object:
{
  "flowScore": 0.0-1.0,
  "issues": [
    {"section": "quote from response", "issue": "description", "severity": "low|medium|high"}
  ],
  "score": 0.0-1.0,
  "confidence": 0.0-1.0,
  "feedback": ["specific coherence issues"]
}

Check for:
- Logical flow between sentences/paragraphs
- Consistency in terminology and concepts
- Abrupt transitions
- Contradictory statements
- Missing connections between ideas
- Score: 1.0 = perfect flow, 0.0 = major coherence issues`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_STRATEGY.COHERENCE,
        messages: [
          { role: 'system', content: 'You are a coherence analyzer. Return only valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`Coherence check failed: ${response.statusText}`);
    }

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);

    return {
      success: result.score >= 0.7,
      score: result.score,
      confidence: result.confidence,
      feedback: result.feedback || [],
      issues: result.issues || [],
      flowScore: result.flowScore || 0,
    };
  } catch (error) {
    console.error('[CoherenceChecker] Error:', error);
    return {
      success: false,
      score: 0,
      confidence: 0,
      feedback: [`Coherence check failed: ${error}`],
      issues: [],
      flowScore: 0,
    };
  }
}

/**
 * Comprehensive Validator Agent
 * Checks citations, completeness, accuracy, and adherence to requirements
 */
export async function validatorAgent(
  response: string,
  question: string,
  context: {
    allowedClaimIds: string[];
    allowedQuoteIds: string[];
    allowedSourceUrls: string[];
    evidenceStrictness: 'high' | 'medium' | 'low';
  },
  apiKey: string
): Promise<ValidationResult> {
  const prompt = `Validate this response for citations, completeness, and accuracy.

QUESTION:
${question}

RESPONSE:
${response}

ALLOWED EVIDENCE IDs:
Claims: ${context.allowedClaimIds.join(', ')}
Quotes: ${context.allowedQuoteIds.join(', ')}
Sources: ${context.allowedSourceUrls.join(', ')}

EVIDENCE STRICTNESS: ${context.evidenceStrictness}

Return ONLY a JSON object:
{
  "citationIssues": [{"citation": "text", "issue": "description"}],
  "completenessScore": 0.0-1.0,
  "accuracyScore": 0.0-1.0,
  "score": 0.0-1.0,
  "confidence": 0.0-1.0,
  "feedback": ["specific validation issues"]
}

Check:
- Citations match allowed IDs
- Response fully answers the question (completeness)
- Citations are appropriate and accurate
- Evidence strictness requirements are met
- Score: weighted average of all checks`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_STRATEGY.VALIDATION,
        messages: [
          { role: 'system', content: 'You are a response validator. Return only valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`Validation failed: ${response.statusText}`);
    }

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);

    return {
      success: result.score >= 0.7,
      score: result.score,
      confidence: result.confidence,
      feedback: result.feedback || [],
      citationIssues: result.citationIssues || [],
      completenessScore: result.completenessScore || 0,
      accuracyScore: result.accuracyScore || 0,
    };
  } catch (error) {
    console.error('[Validator] Error:', error);
    return {
      success: false,
      score: 0,
      confidence: 0,
      feedback: [`Validation failed: ${error}`],
      citationIssues: [],
      completenessScore: 0,
      accuracyScore: 0,
    };
  }
}

/**
 * Summarizer Agent
 * Creates concise summaries while preserving key information
 */
export async function summarizerAgent(
  response: string,
  preferences: {
    mode: 'compact' | 'detailed' | 'hint';
    maxLength?: number;
  },
  apiKey: string
): Promise<SummarizationResult> {
  const modeInstructions = {
    compact: 'Create a concise 2-4 sentence summary',
    detailed: 'Create a comprehensive summary preserving all key points',
    hint: 'Create a 1-2 sentence hint without giving away the answer',
  };

  const prompt = `Summarize this response according to the user's preferences.

RESPONSE:
${response}

PREFERENCES:
Mode: ${preferences.mode}
${preferences.maxLength ? `Max length: ${preferences.maxLength} characters` : ''}

Return ONLY a JSON object:
{
  "summary": "the summarized response",
  "keyPoints": ["key point 1", "key point 2", ...],
  "score": 0.0-1.0,
  "confidence": 0.0-1.0,
  "feedback": ["any notes about the summarization"]
}

${modeInstructions[preferences.mode]}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_STRATEGY.SUMMARIZATION,
        messages: [
          { role: 'system', content: 'You are a summarization expert. Return only valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.5,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`Summarization failed: ${response.statusText}`);
    }

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);

    return {
      success: true,
      score: result.score || 0.9,
      confidence: result.confidence || 0.8,
      feedback: result.feedback || [],
      summary: result.summary || response,
      keyPoints: result.keyPoints || [],
    };
  } catch (error) {
    console.error('[Summarizer] Error:', error);
    return {
      success: false,
      score: 0,
      confidence: 0,
      feedback: [`Summarization failed: ${error}`],
      summary: response, // Fallback to original
      keyPoints: [],
    };
  }
}

/**
 * AI-Based Query Router
 * Determines query complexity and processing requirements (replaces rule-based pattern matching)
 */
export async function queryRouterAgent(
  message: string,
  chatHistory: Array<{ role: string; content: string }>,
  apiKey: string
): Promise<{
  complexity: 'simple' | 'medium' | 'complex';
  needsRetrieval: boolean;
  intent: 'conversational' | 'question' | 'task_creation' | 'itinerary' | 'exploration' | 'self_knowledge' | 'other';
  needsWebSearch: boolean;
  searchQuery: string;
  estimatedProcessingTime: number;
  requiresSelfKnowledge: boolean;
}> {
  const prompt = `Analyze query: "${message}"
History: ${JSON.stringify(chatHistory.slice(-2))}

Return JSON:
{
  "complexity": "simple|medium|complex",
  "needsRetrieval": boolean,
  "intent": "conversational|question|task_creation|itinerary|exploration|self_knowledge|other",
  "needsWebSearch": boolean,
  "searchQuery": "string",
  "estimatedProcessingTime": number,
  "requiresSelfKnowledge": boolean
}

Rules:
- simple: conversational/thanks
- medium: status/definitions
- complex: analysis/planning
- needsWebSearch: current events/news/real-time data (2024-2026)
- requiresSelfKnowledge: User is asking about their own knowledge, notes, or history (e.g., "What do I know about X?")`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_STRATEGY.ROUTING,
        messages: [
          { role: 'system', content: 'You are a query router. Return only valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`Routing failed: ${response.statusText}`);
    }

    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  } catch (error) {
    console.error('[QueryRouter] Error:', error);
    // Fallback: assume medium complexity
    return {
      complexity: 'medium',
      needsRetrieval: true,
      intent: 'question',
      needsWebSearch: false,
      searchQuery: '',
      estimatedProcessingTime: 1000,
      requiresSelfKnowledge: false,
    };
  }
}

/**
 * Refinement Agent
 * Improves response based on feedback from other agents
 */
export async function refinementAgent(
  response: string,
  feedback: {
    factCheck?: FactCheckResult;
    coherence?: CoherenceResult;
    validation?: ValidationResult;
  },
  originalContext: any,
  apiKey: string
): Promise<string> {
  const feedbackSummary = [];

  if (feedback.factCheck && !feedback.factCheck.success) {
    feedbackSummary.push(`FACT CHECK ISSUES: ${feedback.factCheck.feedback.join('; ')}`);
    if (feedback.factCheck.unverifiedClaims.length > 0) {
      feedbackSummary.push(`Unverified claims: ${feedback.factCheck.unverifiedClaims.join(', ')}`);
    }
    if (feedback.factCheck.contradictions.length > 0) {
      feedbackSummary.push(`Contradictions: ${feedback.factCheck.contradictions.map(c => c.claim).join(', ')}`);
    }
  }

  if (feedback.coherence && !feedback.coherence.success) {
    feedbackSummary.push(`COHERENCE ISSUES: ${feedback.coherence.feedback.join('; ')}`);
    if (feedback.coherence.issues.length > 0) {
      feedbackSummary.push(`Flow issues: ${feedback.coherence.issues.map(i => i.issue).join(', ')}`);
    }
  }

  if (feedback.validation && !feedback.validation.success) {
    feedbackSummary.push(`VALIDATION ISSUES: ${feedback.validation.feedback.join('; ')}`);
    if (feedback.validation.citationIssues.length > 0) {
      feedbackSummary.push(`Citation issues: ${feedback.validation.citationIssues.map(c => c.issue).join(', ')}`);
    }
  }

  if (feedbackSummary.length === 0) {
    return response; // No issues to fix
  }

  const prompt = `Refine this response based on the following feedback.

ORIGINAL RESPONSE:
${response}

FEEDBACK:
${feedbackSummary.join('\n\n')}

ORIGINAL CONTEXT (for reference):
${JSON.stringify(originalContext, null, 2).slice(0, 2000)}

Return the improved response that addresses all feedback issues while maintaining accuracy and coherence.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_STRATEGY.REFINEMENT,
        messages: [
          { role: 'system', content: 'You are a response refinement expert. Improve responses based on feedback while maintaining accuracy.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.5,
        max_tokens: 3000,
      }),
    });

    if (!response.ok) {
      throw new Error(`Refinement failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('[Refinement] Error:', error);
    return response; // Fallback to original
  }
}

/**
 * Run all quality agents in parallel
 */
export async function runQualityAgentsInParallel(
  response: string,
  question: string,
  context: any,
  preferences: any,
  apiKey: string
): Promise<{
  factCheck: FactCheckResult;
  coherence: CoherenceResult;
  validation: ValidationResult;
  summarization?: SummarizationResult;
}> {
  const [factCheck, coherence, validation] = await Promise.all([
    factCheckerAgent(response, context, apiKey),
    coherenceCheckerAgent(response, question, apiKey),
    validatorAgent(response, question, context, apiKey),
  ]);

  // Optionally run summarization if needed
  let summarization: SummarizationResult | undefined;
  if (preferences.mode === 'compact' || preferences.mode === 'hint') {
    summarization = await summarizerAgent(response, preferences, apiKey);
  }

  return { factCheck, coherence, validation, summarization };
}

/**
 * Profile Update Agent
 * Extracts personal details from the conversation to update the user's permanent profile.
 */
export async function profileUpdateAgent(
  message: string,
  chatHistory: Array<{ role: string; content: string }>,
  currentProfile: any,
  apiKey: string
): Promise<{
  updates: {
    background?: string[];
    interests?: string[];
    weak_spots?: string[];
    static_profile?: Record<string, any>;
    focus_areas?: string[];
  };
  confidence: number;
}> {
  const prompt = `Analyze the current message and chat history for any NEW personal details about the user that should be saved to their permanent profile.

USER MESSAGE: "${message}"
CHAT HISTORY (LAST 2): ${JSON.stringify(chatHistory.slice(-2))}

CURRENT PROFILE:
${JSON.stringify(currentProfile, null, 2)}

Look for:
- Occupation or school (e.g., "I'm a student at Purdue")
- Skills or expertise (e.g., "I know a lot about CUDA")
- Learning goals or interests
- Weak spots or things they find difficult
- Focus areas (current specific topics they are working on)

Return ONLY a JSON object with any NEW information found. If nothing new, return an empty updates object.
{
  "updates": {
    "background": ["new item"],
    "interests": ["new item"],
    "weak_spots": ["new item"],
    "focus_areas": ["new item"],
    "static_profile": { "occupation": "...", "core_skills": ["..."] }
  },
  "confidence": 0.0-1.0
}

IMPORTANT: Only include information the user explicitly stated or strongly implied. Do not guess.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_STRATEGY.ROUTING, // Use mini for extraction
        messages: [
          { role: 'system', content: 'You are a personal profile extractor. Return only valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`Profile extraction failed: ${response.statusText}`);
    }

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);
    return result;
  } catch (error) {
    console.error('[ProfileUpdateAgent] Error:', error);
    return { updates: {}, confidence: 0 };
  }
}
