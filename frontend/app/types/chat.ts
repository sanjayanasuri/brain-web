export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    metadata?: any;
    actions?: Array<{
        type: 'view_graph' | 'add_to_profile' | 'open_url';
        label: string;
        graph_id?: string;
        url?: string;
        interest?: string;
    }>;
}
