/**
 * Tests for /api/brain-web/chat route handler.
 * 
 * Tests ensure:
 * - Backend /ai/retrieve is called with detail_level: "summary"
 * - Response shape matches expected structure
 * - retrievalMeta is properly capped
 * - No backend context bloat is returned to client
 */
import { POST } from './route';
import { NextRequest } from 'next/server';

// Mock fetch globally
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('/api/brain-web/chat route', () => {
  const mockOpenAIResponse = {
    choices: [{
      message: {
        content: 'ANSWER: This is a test answer.\n\nFOLLOW_UP_QUESTIONS: ["Question 1", "Question 2", "Question 3"]'
      }
    }]
  };

  const styleFeedbackData: Array<Record<string, unknown>> = [];
  const mockUserProfileData = {
    name: 'Test user',
    background: ['Computer Science'],
    interests: ['AI'],
    weak_spots: ['GraphRAG'],
    learning_preferences: {},
  };
  const summariesData: Array<Record<string, unknown>> = [];
  const topicsData: Array<{ name: string }> = [];

  const createOpenAIChoicesResponse = (content: string) => ({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content,
        },
      }],
    }),
  });

  const mockGraphRagFetchSequence = (mockRetrievalResponse: unknown) => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockImplementation(async (input: any, init?: RequestInit): Promise<any> => {
      const requestUrl = typeof input === 'string' ? input : input.url;
      const requestBody = typeof init?.body === 'string' ? init.body : '';

      if (requestUrl.includes('https://api.openai.com/v1/chat/completions')) {
        if (requestBody.includes('You are a query router')) {
          return createOpenAIChoicesResponse(JSON.stringify({
            complexity: 'medium',
            needsRetrieval: true,
            intent: 'question',
            estimatedProcessingTime: 1000,
          }));
        }

        if (requestBody.includes('You are a question analyzer')) {
          return createOpenAIChoicesResponse(JSON.stringify({
            needs_web_search: false,
            reason: 'not needed',
          }));
        }

        if (requestBody.includes('You are a context importance scorer')) {
          return createOpenAIChoicesResponse(JSON.stringify({
            scores: [{
              index: 0,
              score: 0.5,
              reasoning: 'default score',
            }],
          }));
        }

        if (requestBody.includes('You are Brain Web, a teaching assistant')) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => mockOpenAIResponse,
            text: async () => JSON.stringify(mockOpenAIResponse),
          };
        }

        return createOpenAIChoicesResponse(JSON.stringify({
          scores: [],
        }));
      }

      if (requestUrl.includes('/ai/retrieve')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => mockRetrievalResponse,
          text: async () => JSON.stringify(mockRetrievalResponse),
        };
      }

      if (requestUrl.includes('/feedback/style/examples')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => styleFeedbackData,
          text: async () => JSON.stringify(styleFeedbackData),
        };
      }

      if (requestUrl.includes('/preferences/user-profile')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => mockUserProfileData,
          text: async () => JSON.stringify(mockUserProfileData),
        };
      }

      if (requestUrl.includes('/preferences/conversation-summaries')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => summariesData,
          text: async () => JSON.stringify(summariesData),
        };
      }

      if (requestUrl.includes('/preferences/learning-topics')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => topicsData,
          text: async () => JSON.stringify(topicsData),
        };
      }

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({}),
        text: async () => '{}',
      };
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock OpenAI API key
    process.env.OPENAI_API_KEY = 'test-key-sk-1234567890';
  });

  describe('GraphRAG mode', () => {
    it('should call backend /ai/retrieve with detail_level: "summary"', async () => {
      const mockRetrievalResponse = {
        intent: 'DEFINITION_OVERVIEW',
        trace: [
          { step: 'semantic_search_communities', params: {}, counts: { communities: 2 } }
        ],
        context: {
          focus_entities: [
            { node_id: 'node_1', name: 'Concept 1', domain: 'Test', type: 'concept' }
          ],
          claims: [
            { claim_id: 'claim_1', text: 'Test claim', confidence: 0.9, source_id: 'source_1' }
          ],
          top_claims: [
            { claim_id: 'claim_1', text: 'Test claim', confidence: 0.9, source_id: 'source_1' }
          ],
          top_sources: [
            { source_id: 'source_1', title: 'Source 1', url: 'https://example.com' }
          ],
          retrieval_meta: {
            schema_version: 1,
            communities: 2,
            claims: 1,
            concepts: 1,
            edges: 0,
            claimIds: ['claim_1'],
            communityIds: ['comm_1'],
            topClaims: [
              { claim_id: 'claim_1', text: 'Test claim', confidence: 0.9 }
            ]
          }
        },
        plan_version: 'intent_plans_v1'
      };

      mockGraphRagFetchSequence(mockRetrievalResponse);

      const request = new NextRequest('http://localhost/api/brain-web/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'What is machine learning?',
          mode: 'graphrag',
          graph_id: 'default',
          branch_id: 'main'
        })
      });

      const response = await POST(request);
      const data = await response.json();

      // Verify backend was called with detail_level: "summary"
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/ai/retrieve'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"detail_level":"summary"')
        })
      );

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('answer');
    });

    it('should return response with expected shape', async () => {
      const mockRetrievalResponse = {
        intent: 'DEFINITION_OVERVIEW',
        trace: [],
        context: {
          focus_entities: [],
          claims: [],
          top_claims: [],
          top_sources: [],
          retrieval_meta: {
            schema_version: 1,
            communities: 0,
            claims: 0,
            concepts: 0,
            edges: 0,
            claimIds: [],
            communityIds: [],
            topClaims: []
          }
        },
        plan_version: 'intent_plans_v1'
      };

      mockGraphRagFetchSequence(mockRetrievalResponse);

      const request = new NextRequest('http://localhost/api/brain-web/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Test question',
          mode: 'graphrag'
        })
      });

      const response = await POST(request);
      const data = await response.json();

      // Verify response shape
      expect(data).toHaveProperty('answer');
      expect(data).toHaveProperty('usedNodes');
      expect(data).toHaveProperty('suggestedQuestions');
      expect(Array.isArray(data.usedNodes)).toBe(true);
      expect(Array.isArray(data.suggestedQuestions)).toBe(true);
    });

    it('should include retrievalMeta with capped topClaims', async () => {
      const mockRetrievalResponse = {
        intent: 'DEFINITION_OVERVIEW',
        trace: [],
        context: {
          focus_entities: [],
          claims: [],
          top_claims: [
            { claim_id: 'claim_1', text: 'Claim 1', confidence: 0.9 },
            { claim_id: 'claim_2', text: 'Claim 2', confidence: 0.8 },
            { claim_id: 'claim_3', text: 'Claim 3', confidence: 0.7 },
            { claim_id: 'claim_4', text: 'Claim 4', confidence: 0.6 },
            { claim_id: 'claim_5', text: 'Claim 5', confidence: 0.5 },
            { claim_id: 'claim_6', text: 'Claim 6', confidence: 0.4 }, // Should be capped
          ],
          top_sources: [],
          retrieval_meta: {
            schema_version: 1,
            communities: 0,
            claims: 6,
            concepts: 0,
            edges: 0,
            claimIds: ['claim_1', 'claim_2', 'claim_3', 'claim_4', 'claim_5', 'claim_6'],
            communityIds: [],
            topClaims: [
              { claim_id: 'claim_1', text: 'Claim 1', confidence: 0.9 },
              { claim_id: 'claim_2', text: 'Claim 2', confidence: 0.8 },
              { claim_id: 'claim_3', text: 'Claim 3', confidence: 0.7 },
              { claim_id: 'claim_4', text: 'Claim 4', confidence: 0.6 },
              { claim_id: 'claim_5', text: 'Claim 5', confidence: 0.5 },
            ]
          }
        },
        plan_version: 'intent_plans_v1'
      };

      mockGraphRagFetchSequence(mockRetrievalResponse);

      const request = new NextRequest('http://localhost/api/brain-web/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Test question',
          mode: 'graphrag'
        })
      });

      const response = await POST(request);
      const data = await response.json();

      // Verify retrievalMeta exists and topClaims is capped
      expect(data).toHaveProperty('retrievalMeta');
      if (data.retrievalMeta?.topClaims) {
        expect(data.retrievalMeta.topClaims.length).toBeLessThanOrEqual(5);
      }
    });

    it('should not return entire backend context object to client', async () => {
      const mockRetrievalResponse = {
        intent: 'DEFINITION_OVERVIEW',
        trace: [],
        context: {
          focus_entities: [],
          claims: [],
          top_claims: [],
          top_sources: [],
          chunks: ['chunk_1', 'chunk_2'], // Should not be in response
          focus_communities: [{ community_id: 'comm_1', summary: 'Long summary...' }], // Summary should not be in response
          retrieval_meta: {
            schema_version: 1,
            communities: 1,
            claims: 0,
            concepts: 0,
            edges: 0,
            claimIds: [],
            communityIds: ['comm_1'],
            topClaims: []
          }
        },
        plan_version: 'intent_plans_v1'
      };

      mockGraphRagFetchSequence(mockRetrievalResponse);

      const request = new NextRequest('http://localhost/api/brain-web/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Test question',
          mode: 'graphrag'
        })
      });

      const response = await POST(request);
      const data = await response.json();

      // Verify chunks are not in response
      expect(data).not.toHaveProperty('chunks');

      // Verify we only return retrievalMeta, not full context
      expect(data).toHaveProperty('retrievalMeta');
      expect(data.retrievalMeta).not.toHaveProperty('chunks');
    });

    it('should handle finance vertical with lens parameter', async () => {
      const mockRetrievalResponse = {
        intent: 'DEFINITION_OVERVIEW',
        trace: [],
        context: {
          focus_entities: [],
          claims: [],
          top_claims: [],
          top_sources: [],
          retrieval_meta: {
            schema_version: 1,
            communities: 0,
            claims: 0,
            concepts: 0,
            edges: 0,
            claimIds: [],
            communityIds: [],
            topClaims: []
          }
        },
        plan_version: 'intent_plans_v1'
      };

      mockGraphRagFetchSequence(mockRetrievalResponse);

      const request = new NextRequest('http://localhost/api/brain-web/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'AAPL: revenue trends',
          mode: 'graphrag',
          vertical: 'finance',
          lens: 'earnings'
        })
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('answer');
    });
  });
});
