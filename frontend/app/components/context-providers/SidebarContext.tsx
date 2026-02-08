'use client';

import { createContext, useContext, useState, ReactNode, useMemo } from 'react';

interface SidebarContextType {
  isMobileSidebarOpen: boolean;
  setIsMobileSidebarOpen: (open: boolean) => void;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (collapsed: boolean) => void;
  showVoiceAgent: boolean;
  setShowVoiceAgent: (show: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showVoiceAgent, setShowVoiceAgent] = useState(false);

  const value = useMemo(() => ({
    isMobileSidebarOpen,
    setIsMobileSidebarOpen,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    showVoiceAgent,
    setShowVoiceAgent
  }), [isMobileSidebarOpen, isSidebarCollapsed, showVoiceAgent]);

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}

