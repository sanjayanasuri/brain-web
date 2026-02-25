// frontend/app/state/analyticsStore.ts
/**
 * Zustand store for analytics state.
 * Phase 4: Performance tracking, recommendations, and insights.
 */

import { create } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { UseBoundStore } from 'zustand/react';

export interface PerformanceTrend {
    date: string;
    avg_score: number;
    task_count: number;
    session_count: number;
    mode_distribution?: Record<string, number>;
    moving_avg: number;
}

export interface ConceptMastery {
    concept_name: string;
    mastery_score: number;
    exposure_count: number;
    success_count: number;
    success_rate: number;
    last_seen?: string;
}

export interface LearningVelocity {
    weekly_improvement: number;
    trend: 'improving' | 'declining' | 'stable' | 'insufficient_data';
    current_avg: number;
    previous_avg: number;
}

export interface WeakArea {
    concept?: string;
    task_type?: string;
    score: number;
}

export interface Recommendation {
    id: string;
    type: string;
    priority: 'high' | 'medium' | 'low';
    message: string;
    action?: string;
    params?: Record<string, any>;
    created_at: string;
}

export interface SessionStats {
    total_sessions: number;
    completed_sessions: number;
    completion_rate: number;
    total_tasks: number;
    avg_tasks_per_session: number;
    avg_score: number;
}

interface AnalyticsState {
    // Data
    trends: PerformanceTrend[];
    mastery: ConceptMastery[];
    velocity: LearningVelocity | null;
    weakAreas: { weak_concepts: WeakArea[]; weak_task_types: WeakArea[] } | null;
    recommendations: Recommendation[];
    stats: SessionStats | null;

    // UI State
    isLoading: boolean;
    error: string | null;
    selectedDateRange: number; // days

    // Actions
    setTrends: (trends: PerformanceTrend[]) => void;
    setMastery: (mastery: ConceptMastery[]) => void;
    setVelocity: (velocity: LearningVelocity) => void;
    setWeakAreas: (areas: { weak_concepts: WeakArea[]; weak_task_types: WeakArea[] }) => void;
    setRecommendations: (recs: Recommendation[]) => void;
    setStats: (stats: SessionStats) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    setDateRange: (days: number) => void;
    removeRecommendation: (id: string) => void;
    clearAnalytics: () => void;
}

export const useAnalyticsStore = create(
  (set: StoreApi<AnalyticsState>['setState']) => ({
    // Initial state
    trends: [],
    mastery: [],
    velocity: null,
    weakAreas: null,
    recommendations: [],
    stats: null,
    isLoading: false,
    error: null,
    selectedDateRange: 30,

    // Actions
    setTrends: (trends: PerformanceTrend[]) => set({ trends }),

    setMastery: (mastery: ConceptMastery[]) => set({ mastery }),

    setVelocity: (velocity: LearningVelocity) => set({ velocity }),

    setWeakAreas: (areas: { weak_concepts: WeakArea[]; weak_task_types: WeakArea[] }) => set({ weakAreas: areas }),

    setRecommendations: (recs: Recommendation[]) => set({ recommendations: recs }),

    setStats: (stats: SessionStats) => set({ stats }),

    setLoading: (loading: boolean) => set({ isLoading: loading }),

    setError: (error: string | null) => set({ error }),

    setDateRange: (days: number) => set({ selectedDateRange: days }),

    removeRecommendation: (id: string) => set((state: AnalyticsState) => ({
        recommendations: state.recommendations.filter((r: Recommendation) => r.id !== id)
    })),

    clearAnalytics: () => set({
        trends: [],
        mastery: [],
        velocity: null,
        weakAreas: null,
        recommendations: [],
        stats: null,
        error: null
    }),
  }),
) as unknown as UseBoundStore<StoreApi<AnalyticsState>>;
