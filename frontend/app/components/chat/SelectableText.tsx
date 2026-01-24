'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface SelectableTextProps {
  text: string;
  messageId: string;
  onExplain: (startOffset: number, endOffset: number, selectedText: string) => void;
  highlightStart?: number;
  highlightEnd?: number;
}

export default function SelectableText({
  text,
  messageId,
  onExplain,
  highlightStart,
  highlightEnd,
}: SelectableTextProps) {
  const [selection, setSelection] = useState<{ start: number; end: number; text: string } | null>(null);
  const [showExplainButton, setShowExplainButton] = useState(false);
  const [buttonPosition, setButtonPosition] = useState({ top: 0, left: 0 });
  const textRef = useRef<HTMLDivElement>(null);
  
  // Add data attribute for scroll precision
  useEffect(() => {
    if (textRef.current) {
      textRef.current.setAttribute('data-selectable-text', 'true');
    }
  }, []);
  const selectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      setSelection(null);
      setShowExplainButton(false);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!textRef.current?.contains(range.commonAncestorContainer)) {
      setSelection(null);
      setShowExplainButton(false);
      return;
    }

    // Get text content and offsets
    const textNode = textRef.current;
    const textContent = textNode.textContent || '';
    
    // Calculate offsets relative to the text content
    const preRange = document.createRange();
    preRange.selectNodeContents(textNode);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preRange.toString().length;
    
    const postRange = document.createRange();
    postRange.selectNodeContents(textNode);
    postRange.setEnd(range.endContainer, range.endOffset);
    const endOffset = postRange.toString().length;
    
    const selectedText = selection.toString().trim();
    
    if (selectedText.length > 0 && startOffset < endOffset) {
      setSelection({ start: startOffset, end: endOffset, text: selectedText });
      
      // Position button near selection
      const rect = range.getBoundingClientRect();
      const textRect = textRef.current.getBoundingClientRect();
      setButtonPosition({
        top: rect.top - textRect.top + rect.height + 8,
        left: rect.left - textRect.left + rect.width / 2,
      });
      
      // Debounce button appearance
      if (selectionTimeoutRef.current) {
        clearTimeout(selectionTimeoutRef.current);
      }
      selectionTimeoutRef.current = setTimeout(() => {
        setShowExplainButton(true);
      }, 100);
    } else {
      setSelection(null);
      setShowExplainButton(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      if (selectionTimeoutRef.current) {
        clearTimeout(selectionTimeoutRef.current);
      }
    };
  }, [handleMouseUp]);

  const handleExplain = useCallback(() => {
    if (selection) {
      onExplain(selection.start, selection.end, selection.text);
      setSelection(null);
      setShowExplainButton(false);
      window.getSelection()?.removeAllRanges();
    }
  }, [selection, onExplain]);

  // Render text with highlighting
  const renderHighlightedText = () => {
    if (highlightStart === undefined || highlightEnd === undefined) {
      return text;
    }

    const parts = [];
    if (highlightStart > 0) {
      parts.push({ text: text.substring(0, highlightStart), highlight: false });
    }
    parts.push({
      text: text.substring(highlightStart, highlightEnd),
      highlight: true,
    });
    if (highlightEnd < text.length) {
      parts.push({ text: text.substring(highlightEnd), highlight: false });
    }

    return parts.map((part, idx) => (
      <span
        key={idx}
        style={{
          background: part.highlight ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
          padding: part.highlight ? '2px 0' : '0',
          borderRadius: part.highlight ? '3px' : '0',
        }}
      >
        {part.text}
      </span>
    ));
  };

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={textRef}
        style={{
          userSelect: 'text',
          cursor: 'text',
        }}
      >
        {highlightStart !== undefined && highlightEnd !== undefined
          ? renderHighlightedText()
          : text}
      </div>
      
      {showExplainButton && selection && (
        <button
          onClick={handleExplain}
          style={{
            position: 'absolute',
            top: `${buttonPosition.top}px`,
            left: `${buttonPosition.left}px`,
            transform: 'translateX(-50%)',
            padding: '6px 12px',
            background: 'var(--accent)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 500,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 1000,
            whiteSpace: 'nowrap',
          }}
        >
          Explain
        </button>
      )}
    </div>
  );
}
