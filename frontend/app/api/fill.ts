
import { API_BASE_URL, getApiHeaders } from './base';

export interface FillResponse {
    status: string;
    kind: string;
    artifact_id?: string;
    answer?: string;
    data?: any;
}

export async function runFillCommand(command: string, graphId?: string): Promise<FillResponse> {
    const res = await fetch(`${API_BASE_URL}/fill`, {
        method: 'POST',
        headers: await getApiHeaders(),
        body: JSON.stringify({ command, graph_id: graphId }),
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to run fill command: ${res.status} ${errorText}`);
    }

    return res.json();
}
