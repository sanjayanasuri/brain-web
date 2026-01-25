/**
 * Signals related API methods
 */

import { API_BASE_URL } from './base';
import {
    ListSignalsOptions,
    SignalListResponse
} from './types';

export async function listSignals(options: ListSignalsOptions = {}): Promise<SignalListResponse> {
    const params = new URLSearchParams();
    if (options.signal_type) params.append('signal_type', options.signal_type);
    if (options.document_id) params.append('document_id', options.document_id);
    if (options.block_id) params.append('block_id', options.block_id);
    if (options.concept_id) params.append('concept_id', options.concept_id);
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.offset) params.append('offset', options.offset.toString());

    const res = await fetch(`${API_BASE_URL}/signals/?${params.toString()}`);
    if (!res.ok) {
        throw new Error(`Failed to list signals: ${res.statusText}`);
    }
    return res.json();
}
