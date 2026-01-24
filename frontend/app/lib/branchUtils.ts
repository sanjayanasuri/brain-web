import { getAuthHeaders } from './authToken';

/**
 * Utilities for contextual branching operations.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export interface CreateBranchRequest {
  parent_message_id: string;
  parent_message_content: string;
  start_offset: number;
  end_offset: number;
  selected_text: string;
  chat_id?: string | null;
}

export interface BranchResponse {
  branch: {
    id: string;
    anchor: {
      start_offset: number;
      end_offset: number;
      selected_text: string;
      parent_message_id: string;
    };
    messages: Array<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
      timestamp: string;
    }>;
    parent_message_id: string;
  };
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }>;
}

export async function createBranch(request: CreateBranchRequest): Promise<BranchResponse> {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/contextual-branches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('[createBranch] Request failed:', {
      status: response.status,
      statusText: response.statusText,
      error,
      url: `${API_BASE_URL}/contextual-branches`,
    });
    throw new Error(`Failed to create branch: ${error}`);
  }

  return response.json();
}

export async function getBranch(branchId: string): Promise<BranchResponse> {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/contextual-branches/${branchId}`, {
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to load branch');
  }

  return response.json();
}

export async function getMessageBranches(messageId: string, includeArchived: boolean = false) {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(
    `${API_BASE_URL}/contextual-branches/messages/${messageId}/branches?include_archived=${includeArchived}`,
    {
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
    }
  );

  if (!response.ok) {
    throw new Error('Failed to load branches');
  }

  return response.json();
}

export async function archiveBranch(branchId: string): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/contextual-branches/${branchId}/archive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to archive branch: ${error}`);
  }
}

export async function deleteBranch(branchId: string): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/contextual-branches/${branchId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to delete branch: ${error}`);
  }
}

export async function sendBranchMessage(branchId: string, content: string): Promise<{
  user_message: BranchResponse['messages'][0];
  assistant_message: BranchResponse['messages'][0];
}> {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/contextual-branches/${branchId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to send message: ${error}`);
  }

  return response.json();
}

export async function generateBridgingHints(branchId: string): Promise<{
  branch_id: string;
  hints: Array<{
    id: string;
    hint_text: string;
    target_offset: number;
  }>;
}> {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/contextual-branches/${branchId}/hints`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to generate hints: ${error}`);
  }

  return response.json();
}

export async function createMessageVersion(messageId: string, content: string): Promise<{ message_id: string; version: number }> {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${API_BASE_URL}/contextual-branches/messages/${messageId}/new-version`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create message version: ${error}`);
  }

  return response.json();
}
