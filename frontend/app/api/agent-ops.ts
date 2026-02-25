import { API_BASE_URL, getApiHeaders } from './base';

export type AgentRun = {
  task_id?: string;
  id?: string;
  description?: string;
  status?: string;
  tmux_session?: string;
  branch_name?: string;
  pr_number?: number;
  pr_url?: string;
  updated_at?: string;
};

export type AgentIdea = {
  id: string;
  title: string;
  status: string;
  suggested_scope?: string;
};

export async function getAgentOpsState(): Promise<{ runs: AgentRun[]; ideas: AgentIdea[] }> {
  const res = await fetch(`${API_BASE_URL}/agent-ops/runs`, { headers: await getApiHeaders() });
  if (!res.ok) throw new Error('Failed to load agent ops state');
  return res.json();
}

export async function spawnAgentTask(payload: { title: string; scope: string; desc?: string; lane?: string }) {
  const res = await fetch(`${API_BASE_URL}/agent-ops/spawn`, {
    method: 'POST',
    headers: await getApiHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to spawn task');
  return res.json();
}

export async function steerAgentTask(tmux_session: string, message: string) {
  const res = await fetch(`${API_BASE_URL}/agent-ops/steer`, {
    method: 'POST',
    headers: await getApiHeaders(),
    body: JSON.stringify({ tmux_session, message }),
  });
  if (!res.ok) throw new Error('Failed to steer task');
  return res.json();
}

export async function killAgentTask(tmux_session: string) {
  const res = await fetch(`${API_BASE_URL}/agent-ops/kill`, {
    method: 'POST',
    headers: await getApiHeaders(),
    body: JSON.stringify({ tmux_session }),
  });
  if (!res.ok) throw new Error('Failed to kill task');
  return res.json();
}

export async function runAgentTick() {
  const res = await fetch(`${API_BASE_URL}/agent-ops/tick`, {
    method: 'POST',
    headers: await getApiHeaders(),
  });
  if (!res.ok) throw new Error('Failed to run tick');
  return res.json();
}
