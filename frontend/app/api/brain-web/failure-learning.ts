/**
 * Failure Learning System
 * 
 * Tracks failures, learns patterns, and adapts prompts/strategies over time.
 * All analysis uses AI - no rule-based learning.
 */

export interface FailureRecord {
  timestamp: number;
  query: string;
  response: string;
  failureType: 'fact_check' | 'coherence' | 'validation' | 'citation' | 'completeness' | 'other';
  failureDetails: string;
  agentScores: {
    factCheck?: number;
    coherence?: number;
    validation?: number;
  };
  context?: any;
}

export interface FailurePattern {
  pattern: string;
  frequency: number;
  commonFailures: string[];
  suggestedFix: string;
  confidence: number;
}

/**
 * Analyze failure patterns using AI
 */
export async function analyzeFailurePatterns(
  failures: FailureRecord[],
  apiKey: string
): Promise<FailurePattern[]> {
  if (failures.length === 0) return [];

  const prompt = `Analyze these failure records and identify patterns.

FAILURES:
${failures.slice(0, 50).map((f, idx) => 
  `${idx + 1}. Query: "${f.query}"
   Failure: ${f.failureType} - ${f.failureDetails}
   Scores: ${JSON.stringify(f.agentScores)}`
).join('\n\n')}

Return ONLY a JSON object:
{
  "patterns": [
    {
      "pattern": "description of the pattern",
      "frequency": number,
      "commonFailures": ["failure 1", "failure 2"],
      "suggestedFix": "how to fix this pattern",
      "confidence": 0.0-1.0
    }
  ]
}

Identify:
- Common query types that fail
- Recurring failure modes
- Agent score patterns
- Context-related issues
- Suggested improvements`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a failure pattern analyzer. Return only valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 3000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`Pattern analysis failed: ${response.statusText}`);
    }

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);
    
    return result.patterns || [];
  } catch (error) {
    console.error('[FailureLearning] Analysis error:', error);
    return [];
  }
}

/**
 * Generate improved prompt based on failure patterns
 */
export async function generateImprovedPrompt(
  basePrompt: string,
  patterns: FailurePattern[],
  apiKey: string
): Promise<string> {
  if (patterns.length === 0) return basePrompt;

  const prompt = `Improve this system prompt based on identified failure patterns.

BASE PROMPT:
${basePrompt}

FAILURE PATTERNS:
${patterns.map((p, idx) => 
  `${idx + 1}. ${p.pattern} (frequency: ${p.frequency})
   Common failures: ${p.commonFailures.join(', ')}
   Suggested fix: ${p.suggestedFix}`
).join('\n\n')}

Return the improved prompt that addresses these patterns while maintaining the original intent.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a prompt engineering expert. Improve prompts based on failure patterns.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 3000,
      }),
    });

    if (!response.ok) {
      throw new Error(`Prompt improvement failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('[FailureLearning] Prompt improvement error:', error);
    return basePrompt; // Fallback to original
  }
}

/**
 * Store failure record (in-memory for now, can be persisted to DB)
 */
const failureStore: FailureRecord[] = [];
const MAX_STORED_FAILURES = 1000;

export function recordFailure(failure: FailureRecord): void {
  failureStore.push(failure);
  
  // Keep only recent failures
  if (failureStore.length > MAX_STORED_FAILURES) {
    failureStore.shift();
  }
}

export function getRecentFailures(limit: number = 50): FailureRecord[] {
  return failureStore.slice(-limit);
}

/**
 * Get failure statistics
 */
export function getFailureStats(): {
  totalFailures: number;
  byType: Record<string, number>;
  averageScores: {
    factCheck: number;
    coherence: number;
    validation: number;
  };
} {
  const byType: Record<string, number> = {};
  let factCheckSum = 0;
  let coherenceSum = 0;
  let validationSum = 0;
  let factCheckCount = 0;
  let coherenceCount = 0;
  let validationCount = 0;

  for (const failure of failureStore) {
    byType[failure.failureType] = (byType[failure.failureType] || 0) + 1;
    
    if (failure.agentScores.factCheck !== undefined) {
      factCheckSum += failure.agentScores.factCheck;
      factCheckCount++;
    }
    if (failure.agentScores.coherence !== undefined) {
      coherenceSum += failure.agentScores.coherence;
      coherenceCount++;
    }
    if (failure.agentScores.validation !== undefined) {
      validationSum += failure.agentScores.validation;
      validationCount++;
    }
  }

  return {
    totalFailures: failureStore.length,
    byType,
    averageScores: {
      factCheck: factCheckCount > 0 ? factCheckSum / factCheckCount : 0,
      coherence: coherenceCount > 0 ? coherenceSum / coherenceCount : 0,
      validation: validationCount > 0 ? validationSum / validationCount : 0,
    },
  };
}

/**
 * Learn from failures and update system (called periodically)
 */
export async function learnFromFailures(apiKey: string): Promise<{
  patterns: FailurePattern[];
  improvedPrompts?: Record<string, string>;
}> {
  const recentFailures = getRecentFailures(100);
  
  if (recentFailures.length < 5) {
    return { patterns: [] }; // Not enough data
  }

  const patterns = await analyzeFailurePatterns(recentFailures, apiKey);
  
  // Generate improved prompts for common patterns
  const improvedPrompts: Record<string, string> = {};
  for (const pattern of patterns.slice(0, 3)) { // Top 3 patterns
    if (pattern.confidence > 0.7) {
      // This would be used to update system prompts
      // For now, just return the pattern
    }
  }

  return { patterns, improvedPrompts };
}
