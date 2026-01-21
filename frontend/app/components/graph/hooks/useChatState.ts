'use client';

import { useReducer, useCallback } from 'react';
import type { EvidenceItem } from '../../../types/evidence';
import type { Concept } from '../../../api-client';

interface AnswerSection {
  id: string;
  heading?: string;
  text: string;
  supporting_evidence_ids: string[];
}

interface RetrievalMeta {
  communities: number;
  claims: number;
  concepts: number;
  edges: number;
  sourceBreakdown?: Record<string, number>;
  claimIds?: string[];
  communityIds?: string[];
  topClaims?: Array<{
    claim_id: string;
    text: string;
    confidence?: number;
    source_id?: string;
    published_at?: string;
  }>;
}

interface SuggestedAction {
  type: string;
  source?: string;
  target?: string;
  concept?: string;
  domain?: string;
  label: string;
}

export interface ChatMessage {
  id: string;
  question: string;
  answer: string;
  answerId: string | null;
  answerSections: AnswerSection[] | null;
  timestamp: number;
  suggestedQuestions: string[];
  usedNodes: Concept[];
  suggestedActions: SuggestedAction[];
  retrievalMeta: RetrievalMeta | null;
  evidenceUsed: EvidenceItem[];
}

interface ChatState {
  chatAnswer: string | null;
  answerId: string | null;
  answerSections: AnswerSection[] | null;
  lastQuestion: string;
  suggestedQuestions: string[];
  usedNodes: Concept[];
  suggestedActions: SuggestedAction[];
  retrievalMeta: RetrievalMeta | null;
  evidenceUsed: EvidenceItem[];
  expandedEvidenceSections: Set<string>;
  isChatLoading: boolean;
  loadingStage: string;
  isEditingAnswer: boolean;
  editedAnswer: string;
  isChatExpanded: boolean;
  isChatMaximized: boolean;
  isChatCollapsed: boolean;
  chatMode: 'Ask' | 'Explore Paths' | 'Summaries' | 'Gaps';
  showingEvidence: boolean;
  evidenceNodeIds: Set<string>;
  evidenceLinkIds: Set<string>;
  activeEvidenceSectionId: string | null;
  showRetrievalDetails: boolean;
  showEvidencePreview: boolean;
  chatHistory: ChatMessage[]; // Full conversation history
}

type ChatAction =
  | { type: 'SET_CHAT_ANSWER'; payload: string | null }
  | { type: 'SET_ANSWER_ID'; payload: string | null }
  | { type: 'SET_ANSWER_SECTIONS'; payload: AnswerSection[] | null }
  | { type: 'SET_LAST_QUESTION'; payload: string }
  | { type: 'SET_SUGGESTED_QUESTIONS'; payload: string[] }
  | { type: 'SET_USED_NODES'; payload: Concept[] }
  | { type: 'SET_SUGGESTED_ACTIONS'; payload: SuggestedAction[] }
  | { type: 'SET_RETRIEVAL_META'; payload: RetrievalMeta | null }
  | { type: 'SET_EVIDENCE_USED'; payload: EvidenceItem[] }
  | { type: 'TOGGLE_EVIDENCE_SECTION'; payload: string }
  | { type: 'SET_CHAT_LOADING'; payload: boolean }
  | { type: 'SET_LOADING_STAGE'; payload: string }
  | { type: 'SET_EDITING_ANSWER'; payload: boolean }
  | { type: 'SET_EDITED_ANSWER'; payload: string }
  | { type: 'SET_CHAT_EXPANDED'; payload: boolean }
  | { type: 'SET_CHAT_MAXIMIZED'; payload: boolean }
  | { type: 'SET_CHAT_COLLAPSED'; payload: boolean }
  | { type: 'SET_CHAT_MODE'; payload: 'Ask' | 'Explore Paths' | 'Summaries' | 'Gaps' }
  | { type: 'SET_SHOWING_EVIDENCE'; payload: boolean }
  | { type: 'SET_EVIDENCE_NODE_IDS'; payload: Set<string> }
  | { type: 'SET_EVIDENCE_LINK_IDS'; payload: Set<string> }
  | { type: 'SET_ACTIVE_EVIDENCE_SECTION_ID'; payload: string | null }
  | { type: 'SET_SHOW_RETRIEVAL_DETAILS'; payload: boolean }
  | { type: 'SET_SHOW_EVIDENCE_PREVIEW'; payload: boolean }
  | { type: 'ADD_CHAT_MESSAGE'; payload: ChatMessage }
  | { type: 'SET_CHAT_HISTORY'; payload: ChatMessage[] }
  | { type: 'RESET_CHAT' };

const CHAT_HISTORY_STORAGE_KEY = 'brainweb:chatHistory';
const MAX_CHAT_HISTORY = 50; // Keep last 50 messages

function loadChatHistoryFromStorage(): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
    if (!stored) return [];
    const history = JSON.parse(stored);
    // Ensure timestamps are numbers
    return history.map((msg: ChatMessage) => ({
      ...msg,
      timestamp: typeof msg.timestamp === 'string' ? new Date(msg.timestamp).getTime() : msg.timestamp,
    }));
  } catch {
    return [];
  }
}

function saveChatHistoryToStorage(history: ChatMessage[]): void {
  if (typeof window === 'undefined') return;
  try {
    // Keep only last MAX_CHAT_HISTORY messages
    const trimmed = history.slice(-MAX_CHAT_HISTORY);
    localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore storage errors
  }
}

const initialState: ChatState = {
  chatAnswer: null,
  answerId: null,
  answerSections: null,
  lastQuestion: '',
  suggestedQuestions: [],
  usedNodes: [],
  suggestedActions: [],
  retrievalMeta: null,
  evidenceUsed: [],
  expandedEvidenceSections: new Set(),
  isChatLoading: false,
  loadingStage: '',
  isEditingAnswer: false,
  editedAnswer: '',
  isChatExpanded: false,
  isChatMaximized: false,
  isChatCollapsed: false,
  chatMode: 'Ask',
  showingEvidence: false,
  evidenceNodeIds: new Set(),
  evidenceLinkIds: new Set(),
  activeEvidenceSectionId: null,
  showRetrievalDetails: false,
  showEvidencePreview: false,
  chatHistory: loadChatHistoryFromStorage(),
};

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SET_CHAT_ANSWER':
      return { ...state, chatAnswer: action.payload };
    case 'SET_ANSWER_ID':
      return { ...state, answerId: action.payload };
    case 'SET_ANSWER_SECTIONS':
      return { ...state, answerSections: action.payload };
    case 'SET_LAST_QUESTION':
      return { ...state, lastQuestion: action.payload };
    case 'SET_SUGGESTED_QUESTIONS':
      return { ...state, suggestedQuestions: action.payload };
    case 'SET_USED_NODES':
      return { ...state, usedNodes: action.payload };
    case 'SET_SUGGESTED_ACTIONS':
      return { ...state, suggestedActions: action.payload };
    case 'SET_RETRIEVAL_META':
      return { ...state, retrievalMeta: action.payload };
    case 'SET_EVIDENCE_USED':
      return { ...state, evidenceUsed: action.payload };
    case 'TOGGLE_EVIDENCE_SECTION': {
      const newSet = new Set(state.expandedEvidenceSections);
      if (newSet.has(action.payload)) {
        newSet.delete(action.payload);
      } else {
        newSet.add(action.payload);
      }
      return { ...state, expandedEvidenceSections: newSet };
    }
    case 'SET_CHAT_LOADING':
      return { ...state, isChatLoading: action.payload };
    case 'SET_LOADING_STAGE':
      return { ...state, loadingStage: action.payload };
    case 'SET_EDITING_ANSWER':
      return { ...state, isEditingAnswer: action.payload };
    case 'SET_EDITED_ANSWER':
      return { ...state, editedAnswer: action.payload };
    case 'SET_CHAT_EXPANDED':
      return { ...state, isChatExpanded: action.payload };
    case 'SET_CHAT_MAXIMIZED':
      return { ...state, isChatMaximized: action.payload };
    case 'SET_CHAT_COLLAPSED':
      return { ...state, isChatCollapsed: action.payload };
    case 'SET_CHAT_MODE':
      return { ...state, chatMode: action.payload };
    case 'SET_SHOWING_EVIDENCE':
      return { ...state, showingEvidence: action.payload };
    case 'SET_EVIDENCE_NODE_IDS':
      return { ...state, evidenceNodeIds: action.payload };
    case 'SET_EVIDENCE_LINK_IDS':
      return { ...state, evidenceLinkIds: action.payload };
    case 'SET_ACTIVE_EVIDENCE_SECTION_ID':
      return { ...state, activeEvidenceSectionId: action.payload };
    case 'SET_SHOW_RETRIEVAL_DETAILS':
      return { ...state, showRetrievalDetails: action.payload };
    case 'SET_SHOW_EVIDENCE_PREVIEW':
      return { ...state, showEvidencePreview: action.payload };
    case 'ADD_CHAT_MESSAGE': {
      const newHistory = [...state.chatHistory, action.payload];
      saveChatHistoryToStorage(newHistory);
      return { ...state, chatHistory: newHistory };
    }
    case 'SET_CHAT_HISTORY':
      saveChatHistoryToStorage(action.payload);
      return { ...state, chatHistory: action.payload };
    case 'RESET_CHAT':
      return {
        ...initialState,
        chatMode: state.chatMode, // Preserve chat mode
        isChatExpanded: state.isChatExpanded, // Preserve UI state
        isChatMaximized: state.isChatMaximized,
        isChatCollapsed: state.isChatCollapsed, // Preserve collapsed state
        chatHistory: [], // Clear history on reset
      };
    default:
      return state;
  }
}

export function useChatState() {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  
  const actions = {
    setChatAnswer: useCallback((answer: string | null) => {
      dispatch({ type: 'SET_CHAT_ANSWER', payload: answer });
    }, []),
    setAnswerId: useCallback((id: string | null) => {
      dispatch({ type: 'SET_ANSWER_ID', payload: id });
    }, []),
    setAnswerSections: useCallback((sections: AnswerSection[] | null) => {
      dispatch({ type: 'SET_ANSWER_SECTIONS', payload: sections });
    }, []),
    setLastQuestion: useCallback((question: string) => {
      dispatch({ type: 'SET_LAST_QUESTION', payload: question });
    }, []),
    setSuggestedQuestions: useCallback((questions: string[]) => {
      dispatch({ type: 'SET_SUGGESTED_QUESTIONS', payload: questions });
    }, []),
    setUsedNodes: useCallback((nodes: Concept[]) => {
      dispatch({ type: 'SET_USED_NODES', payload: nodes });
    }, []),
    setSuggestedActions: useCallback((actions: SuggestedAction[]) => {
      dispatch({ type: 'SET_SUGGESTED_ACTIONS', payload: actions });
    }, []),
    setRetrievalMeta: useCallback((meta: RetrievalMeta | null) => {
      dispatch({ type: 'SET_RETRIEVAL_META', payload: meta });
    }, []),
    setEvidenceUsed: useCallback((evidence: EvidenceItem[]) => {
      dispatch({ type: 'SET_EVIDENCE_USED', payload: evidence });
    }, []),
    toggleEvidenceSection: useCallback((id: string) => {
      dispatch({ type: 'TOGGLE_EVIDENCE_SECTION', payload: id });
    }, []),
    setChatLoading: useCallback((loading: boolean) => {
      dispatch({ type: 'SET_CHAT_LOADING', payload: loading });
    }, []),
    setLoadingStage: useCallback((stage: string) => {
      dispatch({ type: 'SET_LOADING_STAGE', payload: stage });
    }, []),
    setEditingAnswer: useCallback((editing: boolean) => {
      dispatch({ type: 'SET_EDITING_ANSWER', payload: editing });
    }, []),
    setEditedAnswer: useCallback((answer: string) => {
      dispatch({ type: 'SET_EDITED_ANSWER', payload: answer });
    }, []),
    setChatExpanded: useCallback((expanded: boolean) => {
      dispatch({ type: 'SET_CHAT_EXPANDED', payload: expanded });
    }, []),
    setChatMaximized: useCallback((maximized: boolean) => {
      dispatch({ type: 'SET_CHAT_MAXIMIZED', payload: maximized });
    }, []),
    setChatCollapsed: useCallback((collapsed: boolean) => {
      dispatch({ type: 'SET_CHAT_COLLAPSED', payload: collapsed });
    }, []),
    setChatMode: useCallback((mode: 'Ask' | 'Explore Paths' | 'Summaries' | 'Gaps') => {
      dispatch({ type: 'SET_CHAT_MODE', payload: mode });
    }, []),
    setShowingEvidence: useCallback((showing: boolean) => {
      dispatch({ type: 'SET_SHOWING_EVIDENCE', payload: showing });
    }, []),
    setEvidenceNodeIds: useCallback((ids: Set<string>) => {
      dispatch({ type: 'SET_EVIDENCE_NODE_IDS', payload: ids });
    }, []),
    setEvidenceLinkIds: useCallback((ids: Set<string>) => {
      dispatch({ type: 'SET_EVIDENCE_LINK_IDS', payload: ids });
    }, []),
    setActiveEvidenceSectionId: useCallback((id: string | null) => {
      dispatch({ type: 'SET_ACTIVE_EVIDENCE_SECTION_ID', payload: id });
    }, []),
    setShowRetrievalDetails: useCallback((show: boolean) => {
      dispatch({ type: 'SET_SHOW_RETRIEVAL_DETAILS', payload: show });
    }, []),
    setShowEvidencePreview: useCallback((show: boolean) => {
      dispatch({ type: 'SET_SHOW_EVIDENCE_PREVIEW', payload: show });
    }, []),
    resetChat: useCallback(() => {
      dispatch({ type: 'RESET_CHAT' });
    }, []),
    addChatMessage: useCallback((message: ChatMessage) => {
      dispatch({ type: 'ADD_CHAT_MESSAGE', payload: message });
    }, []),
    setChatHistory: useCallback((history: ChatMessage[]) => {
      dispatch({ type: 'SET_CHAT_HISTORY', payload: history });
    }, []),
  };
  
  return { state, actions };
}

