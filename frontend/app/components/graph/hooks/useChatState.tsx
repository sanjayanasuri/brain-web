'use client';

import { useReducer, useCallback, useMemo } from 'react';
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
  eventId?: string | null;
  answerSections: AnswerSection[] | null;
  timestamp: number;
  suggestedQuestions: string[];
  usedNodes: Concept[];
  suggestedActions: SuggestedAction[];
  retrievalMeta: RetrievalMeta | null;
  evidenceUsed: EvidenceItem[];
  anchorCitations?: any[];
  extractedGraphData?: any;
  webSearchResults?: Array<{ title: string; snippet: string; link: string; fullContent?: string; graph?: any }>;
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
  chatHistory: ChatMessage[];
}

type ChatAction =
  | { type: 'SET_CHAT_ANSWER', payload: string | null }
  | { type: 'SET_ANSWER_ID', payload: string | null }
  | { type: 'SET_ANSWER_SECTIONS', payload: AnswerSection[] | null }
  | { type: 'SET_LAST_QUESTION', payload: string }
  | { type: 'SET_SUGGESTED_QUESTIONS', payload: string[] }
  | { type: 'SET_USED_NODES', payload: Concept[] }
  | { type: 'SET_SUGGESTED_ACTIONS', payload: SuggestedAction[] }
  | { type: 'SET_RETRIEVAL_META', payload: RetrievalMeta | null }
  | { type: 'SET_EVIDENCE_USED', payload: EvidenceItem[] }
  | { type: 'TOGGLE_EVIDENCE_SECTION', payload: string }
  | { type: 'SET_CHAT_LOADING', payload: boolean }
  | { type: 'SET_LOADING_STAGE', payload: string }
  | { type: 'SET_EDITING_ANSWER', payload: boolean }
  | { type: 'SET_EDITED_ANSWER', payload: string }
  | { type: 'SET_CHAT_EXPANDED', payload: boolean }
  | { type: 'SET_CHAT_MAXIMIZED', payload: boolean }
  | { type: 'SET_CHAT_COLLAPSED', payload: boolean }
  | { type: 'SET_CHAT_MODE', payload: 'Ask' | 'Explore Paths' | 'Summaries' | 'Gaps' }
  | { type: 'SET_SHOWING_EVIDENCE', payload: boolean }
  | { type: 'SET_EVIDENCE_NODE_IDS', payload: Set<string> }
  | { type: 'SET_EVIDENCE_LINK_IDS', payload: Set<string> }
  | { type: 'SET_ACTIVE_EVIDENCE_SECTION_ID', payload: string | null }
  | { type: 'SET_SHOW_RETRIEVAL_DETAILS', payload: boolean }
  | { type: 'SET_SHOW_EVIDENCE_PREVIEW', payload: boolean }
  | { type: 'ADD_CHAT_MESSAGE', payload: ChatMessage }
  | { type: 'UPDATE_CHAT_MESSAGE', payload: { id: string, updates: Partial<ChatMessage> } }
  | { type: 'SET_CHAT_HISTORY', payload: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]) }
  | { type: 'RESET_CHAT' };

const CHAT_HISTORY_STORAGE_KEY = 'brainweb:chatHistory';
const MAX_CHAT_HISTORY = 50;

function loadChatHistoryFromStorage(): ChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
    if (!stored) return [];
    const history = JSON.parse(stored);
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
    const trimmed = history.slice(-MAX_CHAT_HISTORY);
    localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
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
  chatHistory: [],
};

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SET_CHAT_ANSWER': return { ...state, chatAnswer: action.payload };
    case 'SET_ANSWER_ID': return { ...state, answerId: action.payload };
    case 'SET_ANSWER_SECTIONS': return { ...state, answerSections: action.payload };
    case 'SET_LAST_QUESTION': return { ...state, lastQuestion: action.payload };
    case 'SET_SUGGESTED_QUESTIONS': return { ...state, suggestedQuestions: action.payload };
    case 'SET_USED_NODES': return { ...state, usedNodes: action.payload };
    case 'SET_SUGGESTED_ACTIONS': return { ...state, suggestedActions: action.payload };
    case 'SET_RETRIEVAL_META': return { ...state, retrievalMeta: action.payload };
    case 'SET_EVIDENCE_USED': return { ...state, evidenceUsed: action.payload };
    case 'TOGGLE_EVIDENCE_SECTION': {
      const newSet = new Set(state.expandedEvidenceSections);
      if (newSet.has(action.payload)) newSet.delete(action.payload);
      else newSet.add(action.payload);
      return { ...state, expandedEvidenceSections: newSet };
    }
    case 'SET_CHAT_LOADING': return { ...state, isChatLoading: action.payload };
    case 'SET_LOADING_STAGE': return { ...state, loadingStage: action.payload };
    case 'SET_EDITING_ANSWER': return { ...state, isEditingAnswer: action.payload };
    case 'SET_EDITED_ANSWER': return { ...state, editedAnswer: action.payload };
    case 'SET_CHAT_EXPANDED': return { ...state, isChatExpanded: action.payload };
    case 'SET_CHAT_MAXIMIZED': return { ...state, isChatMaximized: action.payload };
    case 'SET_CHAT_COLLAPSED': return { ...state, isChatCollapsed: action.payload };
    case 'SET_CHAT_MODE': return { ...state, chatMode: action.payload };
    case 'SET_SHOWING_EVIDENCE': return { ...state, showingEvidence: action.payload };
    case 'SET_EVIDENCE_NODE_IDS': return { ...state, evidenceNodeIds: action.payload };
    case 'SET_EVIDENCE_LINK_IDS': return { ...state, evidenceLinkIds: action.payload };
    case 'SET_ACTIVE_EVIDENCE_SECTION_ID': return { ...state, activeEvidenceSectionId: action.payload };
    case 'SET_SHOW_RETRIEVAL_DETAILS': return { ...state, showRetrievalDetails: action.payload };
    case 'SET_SHOW_EVIDENCE_PREVIEW': return { ...state, showEvidencePreview: action.payload };
    case 'ADD_CHAT_MESSAGE': {
      const newHistory = [...state.chatHistory, action.payload];
      saveChatHistoryToStorage(newHistory);
      return { ...state, chatHistory: newHistory };
    }
    case 'UPDATE_CHAT_MESSAGE': {
      const newHistory = state.chatHistory.map(msg =>
        msg.id === action.payload.id ? { ...msg, ...action.payload.updates } : msg
      );
      saveChatHistoryToStorage(newHistory);
      return { ...state, chatHistory: newHistory };
    }
    case 'SET_CHAT_HISTORY': {
      const newHistory = typeof action.payload === 'function'
        ? action.payload(state.chatHistory)
        : action.payload;
      saveChatHistoryToStorage(newHistory);
      return { ...state, chatHistory: newHistory };
    }
    case 'RESET_CHAT':
      return {
        ...initialState,
        chatMode: state.chatMode,
        isChatExpanded: state.isChatExpanded,
        isChatMaximized: state.isChatMaximized,
        isChatCollapsed: state.isChatCollapsed,
        chatHistory: [],
      };
    default:
      return state;
  }
}

export function useChatState() {
  const [state, dispatch] = useReducer(chatReducer, initialState);

  const actions = useMemo(() => ({
    setChatAnswer: (answer: string | null) => dispatch({ type: 'SET_CHAT_ANSWER', payload: answer }),
    setAnswerId: (id: string | null) => dispatch({ type: 'SET_ANSWER_ID', payload: id }),
    setAnswerSections: (sections: AnswerSection[] | null) => dispatch({ type: 'SET_ANSWER_SECTIONS', payload: sections }),
    setLastQuestion: (question: string) => dispatch({ type: 'SET_LAST_QUESTION', payload: question }),
    setSuggestedQuestions: (questions: string[]) => dispatch({ type: 'SET_SUGGESTED_QUESTIONS', payload: questions }),
    setUsedNodes: (nodes: Concept[]) => dispatch({ type: 'SET_USED_NODES', payload: nodes }),
    setSuggestedActions: (actions: SuggestedAction[]) => dispatch({ type: 'SET_SUGGESTED_ACTIONS', payload: actions }),
    setRetrievalMeta: (meta: RetrievalMeta | null) => dispatch({ type: 'SET_RETRIEVAL_META', payload: meta }),
    setEvidenceUsed: (evidence: EvidenceItem[]) => dispatch({ type: 'SET_EVIDENCE_USED', payload: evidence }),
    toggleEvidenceSection: (id: string) => dispatch({ type: 'TOGGLE_EVIDENCE_SECTION', payload: id }),
    setChatLoading: (loading: boolean) => dispatch({ type: 'SET_CHAT_LOADING', payload: loading }),
    setLoadingStage: (stage: string) => dispatch({ type: 'SET_LOADING_STAGE', payload: stage }),
    setEditingAnswer: (editing: boolean) => dispatch({ type: 'SET_EDITING_ANSWER', payload: editing }),
    setEditedAnswer: (answer: string) => dispatch({ type: 'SET_EDITED_ANSWER', payload: answer }),
    setChatExpanded: (expanded: boolean) => dispatch({ type: 'SET_CHAT_EXPANDED', payload: expanded }),
    setChatMaximized: (maximized: boolean) => dispatch({ type: 'SET_CHAT_MAXIMIZED', payload: maximized }),
    setChatCollapsed: (collapsed: boolean) => dispatch({ type: 'SET_CHAT_COLLAPSED', payload: collapsed }),
    setChatMode: (mode: 'Ask' | 'Explore Paths' | 'Summaries' | 'Gaps') => dispatch({ type: 'SET_CHAT_MODE', payload: mode }),
    setShowingEvidence: (showing: boolean) => dispatch({ type: 'SET_SHOWING_EVIDENCE', payload: showing }),
    setEvidenceNodeIds: (ids: Set<string>) => dispatch({ type: 'SET_EVIDENCE_NODE_IDS', payload: ids }),
    setEvidenceLinkIds: (ids: Set<string>) => dispatch({ type: 'SET_EVIDENCE_LINK_IDS', payload: ids }),
    setActiveEvidenceSectionId: (id: string | null) => dispatch({ type: 'SET_ACTIVE_EVIDENCE_SECTION_ID', payload: id }),
    setShowRetrievalDetails: (show: boolean) => dispatch({ type: 'SET_SHOW_RETRIEVAL_DETAILS', payload: show }),
    setShowEvidencePreview: (show: boolean) => dispatch({ type: 'SET_SHOW_EVIDENCE_PREVIEW', payload: show }),
    resetChat: () => dispatch({ type: 'RESET_CHAT' }),
    addChatMessage: (message: ChatMessage) => dispatch({ type: 'ADD_CHAT_MESSAGE', payload: message }),
    updateChatMessage: (id: string, updates: Partial<ChatMessage>) => dispatch({ type: 'UPDATE_CHAT_MESSAGE', payload: { id, updates } }),
    setChatHistory: (history: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => dispatch({ type: 'SET_CHAT_HISTORY', payload: history }),
  }), []);

  return useMemo(() => ({ state, actions }), [state, actions]);
}

import { createContext, useContext, ReactNode, useEffect, useRef } from 'react';

const ChatContext = createContext<{
  state: ChatState;
  actions: ReturnType<typeof useChatState>['actions'];
} | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const chat = useChatState();

  const hasLoadedRef = useRef(false);
  // Load history on mount to avoid hydration mismatch
  useEffect(() => {
    if (hasLoadedRef.current) return;
    const history = loadChatHistoryFromStorage();
    if (history.length > 0) {
      chat.actions.setChatHistory(history);
    }
    hasLoadedRef.current = true;
  }, [chat.actions]);

  return (
    <ChatContext.Provider value={chat}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) throw new Error('useChat must be used within a ChatProvider');
  return context;
}
