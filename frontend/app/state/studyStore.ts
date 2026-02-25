// frontend/app/state/studyStore.ts
/**
 * Zustand store for adaptive learning system state.
 * Phase 1: Context pack and study panel visibility.
 */

import { create } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { UseBoundStore } from 'zustand/react';

import { AnchorRef } from '../types/unified';

export interface Excerpt {
    excerpt_id: string;
    content: string;
    source_type: string;
    source_id: string;
    relevance_score: number;
    anchor?: AnchorRef;
    metadata?: {
        url?: string;
        title?: string;
        lecture_title?: string;
        segment_index?: number;
    };
}

export interface ContextPack {
    excerpts: Excerpt[];
    concepts: string[];
    metadata?: {
        graph_id?: string;
        branch_id?: string;
        selection_id?: string;
    };
}

export interface ClarifyResponse {
    explanation: string;
    context_pack: ContextPack;
    citations: string[];
}

// ---------- Phase 2: Session State ----------

export interface TaskSpec {
    task_id: string;
    task_type: string;
    prompt: string;
    rubric_json: Record<string, any>;
    context_pack: ContextPack;
    compatible_modes: string[];
    disruption_cost: number;
}

export interface EvaluationResult {
    score_json: Record<string, number>;
    composite_score: number;
    feedback_text: string;
    gap_concepts: string[];
}

export interface Interaction {
    taskId: string;
    taskType: string;
    prompt: string;
    userResponse?: string;
    evaluation?: EvaluationResult;
    timestamp: string;
    rubric?: Record<string, any>;
}

interface StudyState {
    // Phase 1 State
    contextPack: ContextPack | null;
    clarifyResponse: ClarifyResponse | null;
    isStudyPanelOpen: boolean;
    isLoading: boolean;

    // Phase 2 State
    session: StudySession | null;
    currentTask: TaskSpec | null;
    taskHistory: Array<{ taskId: string; taskType: string; compositeScore?: number; createdAt: string }>;
    interactionHistory: Interaction[];
    lastEvaluation: EvaluationResult | null;
    modeState: { current_mode: string; inertia: number; threshold: number } | null;

    // Phase 1 Actions
    setContextPack: (pack: ContextPack | null) => void;
    setClarifyResponse: (response: ClarifyResponse | null) => void;
    toggleStudyPanel: () => void;
    openStudyPanel: () => void;
    closeStudyPanel: () => void;
    setLoading: (loading: boolean) => void;
    clearContext: () => void;

    // Phase 2 Actions
    setSession: (session: StudySession | null) => void;
    setCurrentTask: (task: TaskSpec | null) => void;
    addToTaskHistory: (task: { taskId: string; taskType: string; compositeScore?: number; createdAt: string }) => void;
    addInteraction: (interaction: Interaction) => void;
    updateLastInteraction: (update: Partial<Interaction>) => void;
    setLastEvaluation: (evaluation: EvaluationResult | null) => void;
    setModeState: (state: { current_mode: string; inertia: number; threshold: number } | null) => void;
    clearSession: () => void;
}

export interface StudySession {
    id: string;
    user_id: string;
    tenant_id: string;
    intent: string;
    current_mode: string;
    mode_inertia: number;
    started_at: string;
}

export const useStudyStore = create(
  (set: StoreApi<StudyState>['setState']) => ({
    // Phase 1 Initial state
    contextPack: null,
    clarifyResponse: null,
    isStudyPanelOpen: false,
    isLoading: false,

    // Phase 2 Initial state
    session: null,
    currentTask: null,
    taskHistory: [],
    interactionHistory: [],
    lastEvaluation: null,
    modeState: null,

    // Phase 1 Actions
    setContextPack: (pack: ContextPack | null) => set({ contextPack: pack }),

    setClarifyResponse: (response: ClarifyResponse | null) => set({
        clarifyResponse: response,
        contextPack: response?.context_pack || null,
        isStudyPanelOpen: true,
    }),

    toggleStudyPanel: () => set((state: StudyState) => ({
        isStudyPanelOpen: !state.isStudyPanelOpen
    })),

    openStudyPanel: () => set({ isStudyPanelOpen: true }),

    closeStudyPanel: () => set({ isStudyPanelOpen: false }),

    setLoading: (loading: boolean) => set({ isLoading: loading }),

    clearContext: () => set({
        contextPack: null,
        clarifyResponse: null,
        isStudyPanelOpen: false,
        isLoading: false,
    }),

    // Phase 2 Actions
    setSession: (session: StudySession | null) => set({ session }),

    setCurrentTask: (task: TaskSpec | null) => set((state: StudyState) => {
        if (!task) return { currentTask: null };

        const newInteraction: Interaction = {
            taskId: task.task_id,
            taskType: task.task_type,
            prompt: task.prompt,
            timestamp: new Date().toISOString(),
            rubric: task.rubric_json,
        };

        return {
            currentTask: task,
            isStudyPanelOpen: true,
            interactionHistory: [...state.interactionHistory, newInteraction]
        };
    }),

    addToTaskHistory: (task: { taskId: string; taskType: string; compositeScore?: number; createdAt: string }) => set((state: StudyState) => ({
        taskHistory: [task, ...state.taskHistory].slice(0, 10), // Keep last 10
    })),

    addInteraction: (interaction: Interaction) => set((state: StudyState) => ({
        interactionHistory: [...state.interactionHistory, interaction]
    })),

    updateLastInteraction: (update: Partial<Interaction>) => set((state: StudyState) => {
        if (state.interactionHistory.length === 0) return state;
        const newHistory = [...state.interactionHistory];
        newHistory[newHistory.length - 1] = {
            ...newHistory[newHistory.length - 1],
            ...update
        };
        return { interactionHistory: newHistory };
    }),

    setLastEvaluation: (evaluation: EvaluationResult | null) => set({ lastEvaluation: evaluation }),

    setModeState: (state: StudyState['modeState']) => set({ modeState: state }),

    clearSession: () => set({
        session: null,
        currentTask: null,
        taskHistory: [],
        interactionHistory: [],
        lastEvaluation: null,
        modeState: null,
        isStudyPanelOpen: false,
    }),
  })
) as unknown as UseBoundStore<StoreApi<StudyState>>;
