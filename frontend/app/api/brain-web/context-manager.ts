/**
 * Dynamic Context Manager
 * 
 * Intelligently manages context window size using AI to score importance
 * and truncate/prioritize content dynamically.
 */

export interface ContextChunk {
  content: string;
  type: 'session' | 'quote' | 'claim' | 'concept' | 'source' | 'community';
  id?: string;
  importance?: number; // 0-1 score
}

export interface ContextScore {
  chunk: ContextChunk;
  score: number; // 0-1 importance score
  reasoning: string;
}

/**
 * Score context chunks by importance using AI
 */
export async function scoreContextImportance(
  chunks: ContextChunk[],
  question: string,
  maxTokens: number,
  apiKey: string
): Promise<ContextScore[]> {
  if (chunks.length === 0) return [];

  const prompt = `Score the importance of each context chunk for answering this question.

QUESTION: ${question}

CONTEXT CHUNKS:
${chunks.map((chunk, idx) =>
    `${idx}. [${chunk.type}] ${chunk.id || 'no-id'}\n${chunk.content.slice(0, 500)}`
  ).join('\n\n')}

Return ONLY a JSON object:
{
  "scores": [
    {"index": 0, "score": 0.0-1.0, "reasoning": "why this is important/not important"}
  ]
}

Scoring criteria:
- Direct relevance to question: high score
- Supporting evidence for claims: high score
- Background/context: medium score
- Redundant information: low score
- Unrelated content: very low score

Be strict: prioritize chunks that directly help answer the question.`;

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
          { role: 'system', content: 'You are a context importance scorer. Return only valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`Context scoring failed: ${response.statusText}`);
    }

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);

    return chunks.map((chunk, idx) => {
      const scoreData = result.scores?.find((s: any) => s.index === idx) || { score: 0.5, reasoning: 'No score provided' };
      return {
        chunk,
        score: scoreData.score || 0.5,
        reasoning: scoreData.reasoning || '',
      };
    });
  } catch (error) {
    console.error('[ContextManager] Scoring error:', error);
    // Fallback: equal scores
    return chunks.map(chunk => ({
      chunk,
      score: 0.5,
      reasoning: 'Scoring failed, using default',
    }));
  }
}

/**
 * Build optimized context by selecting most important chunks within token limit
 */
export async function buildOptimizedContext(
  chunks: ContextChunk[],
  question: string,
  maxTokens: number,
  apiKey: string
): Promise<{
  selectedChunks: ContextChunk[];
  totalTokens: number;
  excludedChunks: ContextChunk[];
}> {
  // Score all chunks
  const scored = await scoreContextImportance(chunks, question, maxTokens, apiKey);

  // Sort by score (highest first)
  scored.sort((a, b) => b.score - a.score);

  // Estimate tokens (rough: 1 token ≈ 4 characters)
  const estimateTokens = (text: string) => Math.ceil(text.length / 4);

  const selectedChunks: ContextChunk[] = [];
  const excludedChunks: ContextChunk[] = [];
  let totalTokens = 0;

  for (const { chunk, score } of scored) {
    const chunkTokens = estimateTokens(chunk.content);

    if (totalTokens + chunkTokens <= maxTokens * 0.9) { // Leave 10% buffer
      selectedChunks.push(chunk);
      totalTokens += chunkTokens;
    } else {
      excludedChunks.push(chunk);
    }
  }

  // Always include highest-scoring chunks even if we go slightly over
  if (selectedChunks.length === 0 && scored.length > 0) {
    selectedChunks.push(scored[0].chunk);
    totalTokens = estimateTokens(scored[0].chunk.content);
  }

  return {
    selectedChunks,
    totalTokens,
    excludedChunks,
  };
}

/**
 * Truncate context intelligently if it's too long
 */
export async function truncateContextIntelligently(
  context: string,
  question: string,
  maxTokens: number,
  apiKey: string
): Promise<string> {
  const estimateTokens = (text: string) => Math.ceil(text.length / 4);

  if (estimateTokens(context) <= maxTokens) {
    return context; // No truncation needed
  }

  // Split into chunks (by paragraphs or sections)
  const chunks = context.split(/\n\n+/).map((text, idx) => ({
    content: text,
    type: 'source' as const,
    id: `chunk-${idx}`,
  }));

  const optimized = await buildOptimizedContext(chunks, question, maxTokens, apiKey);

  return optimized.selectedChunks.map(c => c.content).join('\n\n');
}

/**
 * Extract key information from context for summarization
 */
export async function extractKeyContext(
  context: string,
  question: string,
  apiKey: string
): Promise<{
  keyPoints: string[];
  relevantSections: string[];
  summary: string;
}> {
  const prompt = `Extract key information from this context that's relevant to the question.

QUESTION: ${question}

CONTEXT:
${context.slice(0, 8000)} // Limit to avoid token issues

Return ONLY a JSON object:
{
  "keyPoints": ["key point 1", "key point 2", ...],
  "relevantSections": ["section 1", "section 2", ...],
  "summary": "brief summary of most relevant information"
}

Focus on information that directly helps answer the question.`;

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
          { role: 'system', content: 'You are a context analyzer. Return only valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`Key extraction failed: ${response.statusText}`);
    }

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);

    return {
      keyPoints: result.keyPoints || [],
      relevantSections: result.relevantSections || [],
      summary: result.summary || '',
    };
  } catch (error) {
    console.error('[ContextManager] Key extraction error:', error);
    return {
      keyPoints: [],
      relevantSections: [],
      summary: context.slice(0, 500), // Fallback
    };
  }
}
