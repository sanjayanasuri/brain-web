'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import BranchPanel from './BranchPanel';

interface BranchContextType {
  openBranch: (branchId: string, parentMessageId: string, startOffset: number, endOffset: number) => void;
  openAnchorBranch: (branchId: string) => void;
  closeBranch: () => void;
  currentBranchId: string | null;
  currentParentMessageId: string | null;
  scrollToParent: (messageId: string, startOffset: number, endOffset: number) => void;
  getHighlightSpan: (messageId: string) => { start: number; end: number } | null;
  lastBranchUpdate: number;
  notifyBranchUpdate: () => void;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

export function useBranchContext() {
  const context = useContext(BranchContext);
  if (!context) {
    throw new Error('useBranchContext must be used within BranchProvider');
  }
  return context;
}

interface BranchProviderProps {
  children: ReactNode;
}

export function BranchProvider({ children }: BranchProviderProps) {
  const [currentBranchId, setCurrentBranchId] = useState<string | null>(null);
  const [currentParentMessageId, setCurrentParentMessageId] = useState<string | null>(null);
  const [highlightSpan, setHighlightSpan] = useState<{ messageId: string; start: number; end: number } | null>(null);
  const [lastBranchUpdate, setLastBranchUpdate] = useState<number>(0);

  const notifyBranchUpdate = useCallback(() => {
    setLastBranchUpdate(Date.now());
  }, []);

  const openBranch = useCallback((branchId: string, parentMessageId: string, startOffset: number, endOffset: number) => {
    setCurrentBranchId(branchId);
    setCurrentParentMessageId(parentMessageId);
    setHighlightSpan({ messageId: parentMessageId, start: startOffset, end: endOffset });
    setLastBranchUpdate(Date.now());
  }, []);

  const openAnchorBranch = useCallback((branchId: string) => {
    setCurrentBranchId(branchId);
    setCurrentParentMessageId(null);
    setHighlightSpan(null);
    setLastBranchUpdate(Date.now());
  }, []);

  const closeBranch = useCallback(() => {
    setCurrentBranchId(null);
    setCurrentParentMessageId(null);
    setHighlightSpan(null);
  }, []);

  const scrollToParent = useCallback((messageId: string, startOffset: number, endOffset: number) => {
    setHighlightSpan({ messageId, start: startOffset, end: endOffset });

    // Improved scroll-to-offset precision
    const element = document.getElementById(`message-${messageId}`);
    if (element) {
      // First scroll message into view
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Then find the text node and scroll to precise offset
      setTimeout(() => {
        const textNode = element.querySelector('[data-selectable-text]') || element;
        if (textNode && textNode.textContent) {
          const textContent = textNode.textContent;

          // Create a range for the selected span
          const range = document.createRange();

          // Find the text node and set range
          let charCount = 0;
          const walker = document.createTreeWalker(
            textNode,
            NodeFilter.SHOW_TEXT,
            null
          );

          let startNode: Node | null = null;
          let endNode: Node | null = null;
          let startOffsetInNode = 0;
          let endOffsetInNode = 0;

          let node: Node | null;
          while (node = walker.nextNode()) {
            const nodeText = node.textContent || '';
            const nodeLength = nodeText.length;

            // Check if start offset is in this node
            if (!startNode && charCount + nodeLength >= startOffset) {
              startNode = node;
              startOffsetInNode = startOffset - charCount;
            }

            // Check if end offset is in this node
            if (!endNode && charCount + nodeLength >= endOffset) {
              endNode = node;
              endOffsetInNode = endOffset - charCount;
              break;
            }

            charCount += nodeLength;
          }

          // Set range if we found the nodes
          if (startNode && endNode) {
            try {
              range.setStart(startNode, Math.max(0, startOffsetInNode));
              range.setEnd(endNode, Math.min(endNode.textContent?.length || 0, endOffsetInNode));

              // Scroll the range into view with better precision
              const rect = range.getBoundingClientRect();

              // Find scroll container (check for common scroll containers)
              let scrollContainer: HTMLElement | Window = window;
              let current: HTMLElement | null = element.parentElement;

              while (current) {
                const style = window.getComputedStyle(current);
                if (style.overflowY === 'auto' || style.overflowY === 'scroll' ||
                  style.overflow === 'auto' || style.overflow === 'scroll') {
                  scrollContainer = current;
                  break;
                }
                current = current.parentElement;
              }

              if (scrollContainer === window) {
                window.scrollTo({
                  top: window.scrollY + rect.top - window.innerHeight / 2,
                  behavior: 'smooth'
                });
              } else {
                const container = scrollContainer as HTMLElement;
                const containerRect = container.getBoundingClientRect();
                const relativeTop = rect.top - containerRect.top;
                container.scrollTo({
                  top: container.scrollTop + relativeTop - container.clientHeight / 2,
                  behavior: 'smooth'
                });
              }
            } catch (e) {
              // Fallback to simple scroll if range setting fails
              console.warn('Failed to set precise scroll range:', e);
            }
          }
        }
      }, 100); // Small delay to ensure initial scroll completes
    }
  }, []);

  const getHighlightSpan = useCallback((messageId: string) => {
    if (highlightSpan && highlightSpan.messageId === messageId) {
      return { start: highlightSpan.start, end: highlightSpan.end };
    }
    return null;
  }, [highlightSpan]);

  return (
    <BranchContext.Provider
      value={{
        openBranch,
        openAnchorBranch,
        closeBranch,
        currentBranchId,
        currentParentMessageId,
        scrollToParent,
        getHighlightSpan,
        lastBranchUpdate,
        notifyBranchUpdate,
      }}
    >
      {children}
      {currentBranchId && (
        <div style={{
          position: 'fixed',
          right: 0,
          top: 0,
          height: '100vh',
          zIndex: 1000,
        }}>
          <BranchPanel
            branchId={currentBranchId}
            parentMessageId={currentParentMessageId}
            onClose={closeBranch}
            onScrollToParent={scrollToParent}
          />
        </div>
      )}
    </BranchContext.Provider>
  );
}
