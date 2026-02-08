"use client";
// Trivial change to trigger re-compilation and fix potential chunk 404s

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getFocusAreas,
  listGraphs,
  type FocusArea,
  type GraphSummary,
  type CalendarEvent,
  type LocationSuggestion,
} from "../api-client";
import SessionDrawer from "../components/navigation/SessionDrawer";
import { fetchRecentSessions, type SessionSummary } from "../lib/eventsClient";
import {
  getChatSessions,
  setCurrentSessionId,
  createChatSession,
  addMessageToSession,
  type ChatSession,
} from "../lib/chatSessions";
import {
  BranchProvider,
  useBranchContext,
} from "../components/chat/BranchContext";
import ChatMessageWithBranches from "../components/chat/ChatMessageWithBranches";
import { emitChatMessageCreated } from "../lib/sessionEvents";
import { consumeLectureLinkReturn } from "../lib/lectureLinkNavigation";
import { createBranch } from "../lib/branchUtils";
import { getAuthHeaders } from "../lib/authToken";
import { useSidebar } from "../components/context-providers/SidebarContext";
import type { ChatMessage } from "../types/chat";
import ContextPanel from "../components/context/ContextPanel";
import DeepResearchWidget from "../components/DeepResearchWidget";
import CalendarWidget from "../components/calendar/CalendarWidget";
import DayEventsList from "../components/calendar/DayEventsList";
import ChatMessagesList from "../components/chat/ChatMessagesList";
import StudyPanel from "../components/dashboard/StudyPanel";
import VoiceAgentPanel from "../components/voice/VoiceAgentPanel";

function HomePageInner() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [focusAreas, setFocusAreas] = useState<FocusArea[]>([]);
  const [activeGraphId, setActiveGraphId] = useState<string>("");
  const [_suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [_graphs, setGraphs] = useState<GraphSummary[]>([]);
  const { isSidebarCollapsed, setIsSidebarCollapsed, showVoiceAgent, setShowVoiceAgent } = useSidebar();
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(false);
  const [isWebSearchEnabled, setIsWebSearchEnabled] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [currentSessionId, setCurrentSessionIdState] = useState<string | null>(
    null,
  );
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [notesModalSessionId, setNotesModalSessionId] = useState<string | null>(
    null,
  );
  const [activeSidebarTab, setActiveSidebarTab] = useState<
    "activity" | "calendar" | "research"
  >("activity");

  const [notesDigest, setNotesDigest] = useState<any>(null);
  const [notesLoading, setNotesLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [domainConcepts, setDomainConcepts] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const previousSessionIdRef = useRef<string | null>(null);

  // Handle responsive design
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Load focus areas and active graph
  useEffect(() => {
    async function loadData() {
      try {
        const [areas, graphsData] = await Promise.all([
          getFocusAreas().catch(() => []),
          listGraphs().catch(() => ({ graphs: [], active_graph_id: "" })),
        ]);
        setFocusAreas(areas);
        setActiveGraphId(
          graphsData.active_graph_id || graphsData.graphs[0]?.graph_id || "",
        );
        setGraphs(graphsData.graphs || []);

        // Load sessions
        const sessions = await fetchRecentSessions(10);
        setRecentSessions(sessions);

        // Load chat sessions
        const chats = getChatSessions();
        const sortedChats = [...chats].sort(
          (a, b) => b.updatedAt - a.updatedAt,
        );
        setChatSessions(sortedChats.slice(0, 5));

        // Load current session ID if exists (from localStorage)
        if (typeof window !== "undefined") {
          const storedSessionId = localStorage.getItem(
            "brainweb:currentChatSession",
          );
          if (storedSessionId) {
            setCurrentSessionIdState(storedSessionId);
          }
        }

        setSessionsLoading(false);
      } catch (err) {
        console.error("Failed to load data:", err);
        setSessionsLoading(false);
      }
    }
    loadData();
  }, []);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!query.trim() || loading) return;

      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        role: "user",
        content: query.trim(),
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setQuery("");
      setAttachedFiles([]);
      setLoading(true);

      // Map linear messages to structured Q&A pairs for backend history
      const history = [];
      for (let i = 0; i < messages.length; i += 2) {
        if (messages[i].role === 'user') {
          history.push({
            id: messages[i].id,
            question: messages[i].content,
            answer: messages[i + 1]?.content || "",
            timestamp: messages[i].timestamp
          });
        }
      }

      try {
        const response = await fetch("/api/brain-web/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userMessage.content,
            mode: "graphrag",
            graph_id: activeGraphId || "default",
            forceWebSearch: isWebSearchEnabled,
            chatHistory: history,
            response_prefs: {
              mode: "compact",
              ask_question_policy: "at_most_one",
              end_with_next_step: false,
            },
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || "Failed to get response");
        }

        const data = await response.json();
        const answer =
          data.answer || "I apologize, but I could not generate a response.";

        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: answer,
          timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, assistantMessage]);

        // Save chat session
        try {
          if (!currentSessionId) {
            const newSession = await createChatSession(
              userMessage.content,
              answer,
              data.answerId || null,
              null,
              activeGraphId || "default",
            );
            setCurrentSessionIdState(newSession.id);
            setCurrentSessionId(newSession.id);

            // Refresh chat sessions list
            const chats = getChatSessions();
            const sortedChats = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
            setChatSessions(sortedChats.slice(0, 5));
          } else {
            addMessageToSession(
              currentSessionId,
              userMessage.content,
              answer,
              data.answerId || null,
              data.suggestedQuestions || [],
              data.evidenceUsed || [],
            );

            // Refresh chat sessions list
            const chats = getChatSessions();
            const sortedChats = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
            setChatSessions(sortedChats.slice(0, 5));
          }
        } catch (err) {
          console.error("Failed to save chat session:", err);
        }
      } catch (error: any) {
        console.error("Chat error:", error);
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `❌ Error: ${error.message || "Failed to connect to assistant"}. Please check your connection or try again.`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setLoading(false);
      }
    },
    [query, loading, activeGraphId, messages, currentSessionId, isWebSearchEnabled],
  );

  // Auto-scroll to bottom
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading]);

  // Auto-collapse sidebars ONLY when first message is sent
  useEffect(() => {
    if (messages.length === 1) {
      setIsSidebarCollapsed(true);
      setIsRightSidebarCollapsed(true);
    }
  }, [messages.length, setIsSidebarCollapsed]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setAttachedFiles((prev) => [
        ...prev,
        ...Array.from(e.dataTransfer.files),
      ]);
      e.dataTransfer.clearData();
    }
  };

  const handleLoadChatSession = useCallback(
    async (chatSession: ChatSession) => {
      setCurrentSessionIdState(chatSession.id);
      setCurrentSessionId(chatSession.id);
      setActiveGraphId(chatSession.graphId || "");

      // Load messages from session
      const history: ChatMessage[] = [];
      chatSession.messages.forEach(m => {
        history.push({
          id: `q-${Date.now()}-${Math.random()}`,
          role: 'user',
          content: m.question,
          timestamp: chatSession.updatedAt
        });
        history.push({
          id: `a-${Date.now()}-${Math.random()}`,
          role: 'assistant',
          content: m.answer,
          timestamp: chatSession.updatedAt
        });
      });
      setMessages(history);
    },
    [],
  );

  const handleViewNotes = async (sessionId: string) => {
    router.push(`/notes?sessionId=${sessionId}`);
  };

  const handleCloseNotesModal = () => {
    setNotesModalSessionId(null);
    setNotesDigest(null);
  };

  const handleFocusConcept = (conceptName: string) => {
    setQuery(`Tell me more about ${conceptName}`);
  };

  const handleCloseContextPanel = () => {
    setSelectedNode(null);
    setShowContextPanel(false);
  };

  const sectionsWithDedupedEntries = notesDigest?.sections || [];

  return (
    <div
      className="page-container"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: "100%",
        padding: "0",
        background: "var(--background)",
        maxWidth: "none",
        margin: "0",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          flexDirection: "column",
        }}
      >
        {/* Main Column */}
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            flex: 1,
            overflow: "hidden",
            padding: "20px clamp(16px, 5vw, 60px)",
            position: "relative",
            justifyContent: messages.length === 0 ? "center" : "flex-start",
          }}
        >
          <div
            style={{
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: "24px",
              alignItems: "center",
            }}
          >
            {messages.length === 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "24px",
                  width: "100%",
                  paddingTop: "0",
                }}
              >
                <div
                  onClick={() => setShowVoiceAgent(true)}
                  style={{
                    width: "120px",
                    height: "120px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    marginBottom: "0"
                  }}
                  title="Start Voice Session"
                >
                  <div style={{
                    width: "80px",
                    height: "80px",
                    borderRadius: "50%",
                    background: "var(--accent-gradient)",
                    animation: "pulse 3s infinite ease-in-out",
                    boxShadow: "0 0 50px rgba(37, 99, 235, 0.4)"
                  }} />
                </div>

                <div style={{ textAlign: "center" }}>
                  <div
                    style={{
                      fontSize: "clamp(32px, 5vw, 48px)",
                      fontWeight: "700",
                      color: "var(--ink)",
                      marginBottom: "12px",
                      letterSpacing: "-1.5px",
                    }}
                  >
                    What are we learning today?
                  </div>
                  <div
                    style={{
                      fontSize: "20px",
                      color: "var(--muted)",
                      maxWidth: "700px",
                      margin: "0 auto",
                      lineHeight: "1.4",
                    }}
                  >
                    Explore your knowledge graph or the web with agentic research.
                  </div>
                </div>

                <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: "1000px", marginTop: "10px" }}>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      background: "var(--panel)",
                      border: "1px solid var(--border)",
                      borderRadius: "24px",
                      boxShadow: "0 10px 40px -10px rgba(0,0,0,0.12)",
                      padding: "20px 28px",
                      width: "100%",
                    }}
                  >
                    {attachedFiles.length > 0 && (
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
                        {attachedFiles.map((f, i) => (
                          <div key={i} style={{ fontSize: "12px", background: "rgba(0,0,0,0.05)", padding: "4px 10px", borderRadius: "16px", display: "flex", alignItems: "center", gap: "6px", color: "var(--ink)", border: "1px solid var(--border)" }}>
                            <span style={{ maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                            <button type="button" onClick={() => setAttachedFiles(prev => prev.filter((_, idx) => idx !== i))} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", fontSize: "16px" }}>×</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <textarea
                      placeholder="Ask anything..."
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                      style={{ width: "100%", background: "transparent", border: "none", outline: "none", fontSize: "20px", color: "var(--ink)", resize: "none", minHeight: "44px", maxHeight: "150px", padding: "8px 0", lineHeight: "1.5" }}
                      rows={1}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px" }}>
                      <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                        <button type="button" onClick={() => setIsWebSearchEnabled(!isWebSearchEnabled)} style={{ background: "transparent", border: "none", cursor: "pointer", color: isWebSearchEnabled ? "var(--accent)" : "var(--muted)" }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                        </button>
                        <button type="button" onClick={() => fileInputRef.current?.click()} style={{ background: "transparent", border: "none", cursor: "pointer", color: attachedFiles.length > 0 ? "var(--accent)" : "var(--muted)" }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.51a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                        </button>
                        <input type="file" ref={fileInputRef} style={{ display: "none" }} multiple onChange={(e) => { if (e.target.files) setAttachedFiles(Array.from(e.target.files)); }} />
                      </div>
                      <button type="submit" disabled={!query.trim() || loading} style={{ background: query.trim() ? "var(--accent)" : "var(--border)", color: "white", border: "none", width: "42px", height: "42px", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: query.trim() ? "0 6px 16px rgba(37, 99, 235, 0.2)" : "none" }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
                      </button>
                    </div>
                  </div>
                </form>

                {/* Recent Conversations: Compact Vertical List */}
                <div style={{ width: "100%", maxWidth: "600px", marginTop: "30px" }}>
                  <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: "16px", textAlign: "center" }}>
                    Recent Conversations
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {chatSessions.slice(0, 5).map((chatSession) => (
                      <div
                        key={chatSession.id}
                        onClick={() => handleLoadChatSession(chatSession)}
                        style={{
                          padding: "10px 18px",
                          borderRadius: "12px",
                          border: "1px solid var(--border)",
                          cursor: "pointer",
                          background: "var(--panel)",
                          transition: "all 0.2s ease",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          boxShadow: "0 2px 4px rgba(0,0,0,0.01)",
                        }}
                        className="conversation-card"
                      >
                        <div style={{ fontWeight: "500", fontSize: "14px", color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: "20px" }}>
                          {chatSession.title}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--muted)", whiteSpace: "nowrap" }}>
                          {new Date(chatSession.updatedAt).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", width: "100%", gap: "32px", paddingBottom: "100px", height: "100%", overflowY: "auto" }}>
                <ChatMessagesList messages={messages} chatSessionId={currentSessionId} loading={loading} />
                <div ref={messagesEndRef} />

                {/* Floating-style Input for active chat */}
                <div style={{ position: "fixed", bottom: "30px", left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: "1200px", padding: "0 20px", zIndex: 100 }}>
                  <form onSubmit={handleSubmit} style={{ width: "100%" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "20px 24px", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "28px", boxShadow: "0 12px 64px rgba(0,0,0,0.18)", backdropFilter: "blur(16px)" }}>
                      <textarea
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Continue the conversation..."
                        style={{ flex: 1, border: "none", background: "transparent", color: "var(--ink)", fontSize: "20px", outline: "none", resize: "none", minHeight: "32px" }}
                        rows={1}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                      />
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button type="submit" disabled={!query.trim() || loading} style={{ background: "var(--accent)", color: "white", border: "none", width: "36px", height: "36px", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Voice Agent Overlay */}
      {showVoiceAgent && (
        <div style={{ position: "fixed", top: "80px", right: "40px", zIndex: 1000, animation: "fadeIn 0.3s ease-out" }}>
          <VoiceAgentPanel graphId={activeGraphId} branchId="" />
          <button
            onClick={() => setShowVoiceAgent(false)}
            style={{ position: "absolute", top: "-10px", right: "-10px", width: "30px", height: "30px", borderRadius: "50%", background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 2px 10px rgba(0,0,0,0.1)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold" }}
          >
            ×
          </button>
        </div>
      )}

      {/* Notes Modal */}
      {notesModalSessionId && (
        <div onClick={handleCloseNotesModal} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--background)", borderRadius: "12px", padding: "24px", maxWidth: "600px", width: "100%", maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
              <h2 style={{ fontSize: "20px", fontWeight: "600" }}>Session Notes</h2>
              <button onClick={handleCloseNotesModal} style={{ background: "transparent", border: "none", fontSize: "24px", cursor: "pointer" }}>×</button>
            </div>
            {notesLoading ? <div style={{ textAlign: "center" }}>Loading...</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                {sectionsWithDedupedEntries.map((section: any) => (
                  <div key={section.id} style={{ padding: "16px", background: "var(--panel)", borderRadius: "8px", border: "1px solid var(--border)" }}>
                    <div style={{ fontWeight: "600", marginBottom: "12px" }}>{section.title}</div>
                    {section.entries.map((entry: any) => (
                      <div key={entry.id} style={{ fontSize: "14px", padding: "12px", background: "var(--background)", borderRadius: "6px", marginBottom: "8px" }}>
                        {entry.summary_text}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Context Panel Overlay */}
      {showContextPanel && selectedNode && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "flex-end", zIndex: 1000 }}>
          <div style={{ width: "400px", background: "var(--background)", height: "100%", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>{selectedNode.name}</h3>
              <button onClick={handleCloseContextPanel}>×</button>
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              <ContextPanel selectedNode={selectedNode} selectedResources={[]} isResourceLoading={false} resourceError={null} expandedResources={new Set()} setExpandedResources={() => { }} evidenceFilter="all" setEvidenceFilter={() => { }} evidenceSearch="" setEvidenceSearch={() => { }} activeTab="overview" setActiveTab={() => { }} onClose={handleCloseContextPanel} domainColors={new Map()} neighborCount={0} IS_DEMO_MODE={false} />
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{
        __html: `
        @keyframes pulse {
          0% { transform: scale(1); opacity: 0.8; box-shadow: 0 0 15px rgba(59, 130, 246, 0.2); }
          50% { transform: scale(1.1); opacity: 1; box-shadow: 0 0 30px rgba(59, 130, 246, 0.4); }
          100% { transform: scale(1); opacity: 0.8; box-shadow: 0 0 15px rgba(59, 130, 246, 0.2); }
        }
        @keyframes ripple {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(2); opacity: 0; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}} />
    </div>
  );
}

export default function HomePage() {
  return (
    <React.Suspense fallback={<div className="flex h-screen items-center justify-center bg-background"><div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>}>
      <BranchProvider>
        <HomePageInner />
      </BranchProvider>
    </React.Suspense>
  );
}
