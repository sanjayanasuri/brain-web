import { API_BASE_URL, getApiHeaders } from './base';
import type { WorkspaceTemplate, WorkspaceTemplateExportPayload, WorkspaceTemplateListResponse } from './types';

export interface WorkspaceTemplatePayload {
  label: string;
  description?: string | null;
  vertical?: string | null;
  tags?: string[];
  intent?: string | null;
  node_types?: string[];
  starter_nodes?: string[];
  node_layout?: Record<string, any> | null;
  default_checks?: string[];
  connection_patterns?: string[];
  refresh_defaults?: Record<string, any> | null;
}

async function readJsonOrThrow<T>(res: Response, message: string): Promise<T> {
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`${message}: ${res.statusText}${t ? ` - ${t}` : ''}`);
  }
  return res.json();
}

export async function listWorkspaceTemplates(): Promise<WorkspaceTemplateListResponse> {
  const res = await fetch(`${API_BASE_URL}/templates`, {
    headers: await getApiHeaders(),
  });
  return readJsonOrThrow<WorkspaceTemplateListResponse>(res, 'Failed to list templates');
}

export async function getWorkspaceTemplate(templateId: string): Promise<WorkspaceTemplate> {
  const res = await fetch(`${API_BASE_URL}/templates/${encodeURIComponent(templateId)}`, {
    headers: await getApiHeaders(),
  });
  return readJsonOrThrow<WorkspaceTemplate>(res, 'Failed to fetch template');
}

export async function createWorkspaceTemplate(payload: WorkspaceTemplatePayload): Promise<WorkspaceTemplate> {
  const res = await fetch(`${API_BASE_URL}/templates`, {
    method: 'POST',
    headers: await getApiHeaders(),
    body: JSON.stringify(payload),
  });
  return readJsonOrThrow<WorkspaceTemplate>(res, 'Failed to create template');
}

export async function updateWorkspaceTemplate(
  templateId: string,
  payload: Partial<WorkspaceTemplatePayload>
): Promise<WorkspaceTemplate> {
  const res = await fetch(`${API_BASE_URL}/templates/${encodeURIComponent(templateId)}`, {
    method: 'PATCH',
    headers: await getApiHeaders(),
    body: JSON.stringify(payload),
  });
  return readJsonOrThrow<WorkspaceTemplate>(res, 'Failed to update template');
}

export async function deleteWorkspaceTemplate(templateId: string): Promise<{ ok: boolean; template_id: string }> {
  const res = await fetch(`${API_BASE_URL}/templates/${encodeURIComponent(templateId)}`, {
    method: 'DELETE',
    headers: await getApiHeaders(),
  });
  return readJsonOrThrow<{ ok: boolean; template_id: string }>(res, 'Failed to delete template');
}

export async function cloneWorkspaceTemplate(
  templateId: string,
  options?: { mode?: 'clone' | 'version'; label?: string }
): Promise<WorkspaceTemplate> {
  const res = await fetch(`${API_BASE_URL}/templates/${encodeURIComponent(templateId)}/clone`, {
    method: 'POST',
    headers: await getApiHeaders(),
    body: JSON.stringify({
      mode: options?.mode || 'clone',
      label: options?.label || null,
    }),
  });
  return readJsonOrThrow<WorkspaceTemplate>(res, 'Failed to clone template');
}

export async function exportWorkspaceTemplate(templateId: string): Promise<WorkspaceTemplateExportPayload> {
  const res = await fetch(`${API_BASE_URL}/templates/${encodeURIComponent(templateId)}/export`, {
    headers: await getApiHeaders(),
  });
  return readJsonOrThrow<WorkspaceTemplateExportPayload>(res, 'Failed to export template');
}

export async function importWorkspaceTemplate(payload: {
  export_payload: Record<string, any>;
  mode?: 'clone' | 'version';
  label_override?: string;
}): Promise<WorkspaceTemplate> {
  const res = await fetch(`${API_BASE_URL}/templates/import`, {
    method: 'POST',
    headers: await getApiHeaders(),
    body: JSON.stringify({
      export_payload: payload.export_payload,
      mode: payload.mode || 'clone',
      label_override: payload.label_override || null,
    }),
  });
  return readJsonOrThrow<WorkspaceTemplate>(res, 'Failed to import template');
}
