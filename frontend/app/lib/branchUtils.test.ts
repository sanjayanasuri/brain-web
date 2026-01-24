/**
 * Unit tests for branch utility functions.
 * 
 * Tests ensure:
 * - API calls are made correctly
 * - Error handling works
 * - Request/response parsing is correct
 */
import { createBranch, getBranch, getMessageBranches } from './branchUtils';

// Mock fetch globally
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

// Mock localStorage
const mockLocalStorage = {
  getItem: jest.fn(() => 'test-token'),
  setItem: jest.fn(),
  removeItem: jest.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

describe('branchUtils', () => {
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  describe('createBranch', () => {
    it('creates a branch successfully', async () => {
      const mockResponse = {
        branch: {
          id: 'branch-123',
          anchor: {
            start_offset: 10,
            end_offset: 50,
            selected_text: 'Selected text',
            parent_message_id: 'msg-123',
          },
          messages: [],
          parent_message_id: 'msg-123',
        },
        messages: [],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const request = {
        parent_message_id: 'msg-123',
        parent_message_content: 'Full message content',
        start_offset: 10,
        end_offset: 50,
        selected_text: 'Selected text',
        chat_id: 'session-123',
      };

      const result = await createBranch(request);

      expect(global.fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/contextual-branches`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify(request),
        })
      );

      expect(result.branch.id).toBe('branch-123');
      expect(result.branch.anchor.start_offset).toBe(10);
    });

    it('throws error on failed request', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        text: async () => 'Error message',
      });

      const request = {
        parent_message_id: 'msg-123',
        parent_message_content: 'Full message',
        start_offset: 10,
        end_offset: 50,
        selected_text: 'Selected text',
        chat_id: 'session-123',
      };

      await expect(createBranch(request)).rejects.toThrow('Failed to create branch');
    });
  });

  describe('getBranch', () => {
    it('fetches a branch successfully', async () => {
      const mockResponse = {
        branch: {
          id: 'branch-123',
          anchor: {
            start_offset: 10,
            end_offset: 50,
            selected_text: 'Selected text',
            parent_message_id: 'msg-123',
          },
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              content: 'Question',
              timestamp: '2024-01-01T00:00:00Z',
            },
          ],
          parent_message_id: 'msg-123',
        },
        messages: [],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getBranch('branch-123');

      expect(global.fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/contextual-branches/branch-123`,
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
        })
      );

      expect(result.branch.id).toBe('branch-123');
    });
  });

  describe('getMessageBranches', () => {
    it('fetches all branches for a message', async () => {
      const mockResponse = {
        message_id: 'msg-123',
        branches: [
          {
            id: 'branch-1',
            anchor: {
              start_offset: 10,
              end_offset: 50,
              selected_text: 'Text 1',
              parent_message_id: 'msg-123',
            },
          },
          {
            id: 'branch-2',
            anchor: {
              start_offset: 60,
              end_offset: 100,
              selected_text: 'Text 2',
              parent_message_id: 'msg-123',
            },
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await getMessageBranches('msg-123');

      expect(global.fetch).toHaveBeenCalledWith(
        `${API_BASE_URL}/contextual-branches/messages/msg-123/branches?include_archived=false`,
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
          }),
        })
      );

      expect(result.message_id).toBe('msg-123');
      expect(result.branches).toHaveLength(2);
    });
  });
});
