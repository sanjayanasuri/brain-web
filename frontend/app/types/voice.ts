export interface VoiceSession {
    session_id: string;
    started_at: string;
    agent_name: string;
}

export interface VoiceUsage {
    daily_usage_minutes: number;
    daily_limit_minutes: number;
}

export interface MemorySyncEvent {
    id: string;
    source: string;
    memory_id?: string;
    content_preview: string;
    timestamp: string;
    status: string;
}

export interface VoiceInteractionContext {
    system_prompt: string;
    is_eureka: boolean;
}
