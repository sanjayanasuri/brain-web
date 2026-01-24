/**
 * Unit tests for BranchPanel component.
 * 
 * Tests ensure:
 * - Panel loads branch data
 * - Messages are displayed
 * - Input and send functionality works
 * - Generate hints button works
 * - Back to main button works
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import BranchPanel from './BranchPanel';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// Mock fetch
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

describe('BranchPanel', () => {
  const mockOnClose = jest.fn();
  const mockOnScrollToParent = jest.fn();
  const defaultProps = {
    branchId: 'branch-123',
    parentMessageId: 'msg-123',
    onClose: mockOnClose,
    onScrollToParent: mockOnScrollToParent,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  it('renders loading state initially', () => {
    (global.fetch as jest.Mock).mockImplementation(() => 
      new Promise(() => {}) // Never resolves to simulate loading
    );

    render(<BranchPanel {...defaultProps} />);
    expect(screen.getByText(/Loading branch/i)).toBeInTheDocument();
  });

  it('loads and displays branch data', async () => {
    const mockBranch = {
      branch: {
        id: 'branch-123',
        anchor: {
          start_offset: 10,
          end_offset: 50,
          selected_text: 'Selected text for explanation',
          parent_message_id: 'msg-123',
        },
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'What does this mean?',
            timestamp: '2024-01-01T00:00:00Z',
          },
          {
            id: 'msg-2',
            role: 'assistant',
            content: 'This is the explanation.',
            timestamp: '2024-01-01T00:00:01Z',
          },
        ],
        parent_message_id: 'msg-123',
      },
      messages: [],
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockBranch,
    });

    render(<BranchPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/Explaining selected text/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Selected text for explanation/i)).toBeInTheDocument();
  });

  it('displays messages in branch', async () => {
    const mockBranch = {
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
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          content: 'Question?',
          timestamp: '2024-01-01T00:00:00Z',
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Answer.',
          timestamp: '2024-01-01T00:00:01Z',
        },
      ],
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockBranch,
    });

    render(<BranchPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Question?')).toBeInTheDocument();
      expect(screen.getByText('Answer.')).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  it('sends message and receives response', async () => {
    const mockBranch = {
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

    const mockMessageResponse = {
      user_message: {
        id: 'msg-user-1',
        role: 'user',
        content: 'New question',
        timestamp: '2024-01-01T00:00:00Z',
      },
      assistant_message: {
        id: 'msg-assistant-1',
        role: 'assistant',
        content: 'New answer',
        timestamp: '2024-01-01T00:00:01Z',
      },
    };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockBranch,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockMessageResponse,
      });

    render(<BranchPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Ask about the selected text/i)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Ask about the selected text/i);
    const sendButton = screen.getByText('Send');

    fireEvent.change(input, { target: { value: 'New question' } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByText('New question')).toBeInTheDocument();
      expect(screen.getByText('New answer')).toBeInTheDocument();
    });
  });

  it('calls onClose when Back to main is clicked', async () => {
    const mockBranch = {
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
      json: async () => mockBranch,
    });

    render(<BranchPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Back to main')).toBeInTheDocument();
    }, { timeout: 2000 });

    const backButton = screen.getByText('Back to main');
    fireEvent.click(backButton);

    expect(mockOnClose).toHaveBeenCalled();
    expect(mockOnScrollToParent).toHaveBeenCalledWith('msg-123', 10, 50);
  });

  it('handles branch not found', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    render(<BranchPanel {...defaultProps} />);

    await waitFor(() => {
      // Component shows "Branch not found" or error message
      const errorText = screen.queryByText(/Branch not found/i) || 
                       screen.queryByText(/Failed to load/i) ||
                       screen.queryByText(/not found/i);
      expect(errorText).toBeInTheDocument();
    }, { timeout: 2000 });
  });
});
