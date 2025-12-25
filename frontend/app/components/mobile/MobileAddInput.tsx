'use client';

import { useState, useRef, useEffect } from 'react';

interface MobileAddInputProps {
  onAdd: (input: string) => void;
  isLoading?: boolean;
}

export default function MobileAddInput({ onAdd, isLoading }: MobileAddInputProps) {
  const [input, setInput] = useState('');
  const [inputType, setInputType] = useState<'text' | 'url' | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Auto-focus on mount
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const detectInputType = (value: string): 'text' | 'url' | null => {
    if (!value.trim()) return null;
    if (/^https?:\/\//i.test(value.trim())) {
      return 'url';
    }
    return 'text';
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    setInputType(detectInputType(value));
  };

  const handleSubmit = () => {
    if (input.trim() && !isLoading) {
      onAdd(input);
      setInput('');
      setInputType(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Check clipboard for URLs
  useEffect(() => {
    const checkClipboard = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && /^https?:\/\//i.test(text.trim())) {
          // Show a hint that URL is in clipboard
        }
      } catch (err) {
        // Clipboard access denied or not available
      }
    };
    checkClipboard();
  }, []);

  return (
    <div style={{ 
      padding: '24px 16px',
      paddingBottom: '100px',
      maxWidth: '600px',
      margin: '0 auto',
    }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ 
          fontSize: '28px', 
          fontWeight: '700', 
          marginBottom: '8px',
          color: '#111827',
        }}>
          Add Concept
        </h1>
        <p style={{ 
          fontSize: '14px', 
          color: '#6b7280',
          lineHeight: '1.5',
        }}>
          Type a concept name or paste a URL to add it to your knowledge graph
        </p>
      </div>

      <div style={{
        background: 'white',
        borderRadius: '16px',
        padding: '16px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        marginBottom: '16px',
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a concept name or paste a URL..."
          disabled={isLoading}
          style={{
            width: '100%',
            minHeight: '120px',
            fontSize: '16px',
            border: 'none',
            outline: 'none',
            resize: 'none',
            fontFamily: 'inherit',
            lineHeight: '1.5',
            color: '#111827',
          }}
        />

        {inputType && (
          <div style={{
            marginTop: '12px',
            padding: '8px 12px',
            background: inputType === 'url' ? '#eff6ff' : '#f3f4f6',
            borderRadius: '8px',
            fontSize: '13px',
            color: inputType === 'url' ? '#2563eb' : '#6b7280',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <span>{inputType === 'url' ? '🔗' : '📝'}</span>
            <span>
              {inputType === 'url' 
                ? 'URL detected - will create a resource concept' 
                : 'Text concept - will create a new concept node'}
            </span>
          </div>
        )}
      </div>

      <button
        onClick={handleSubmit}
        disabled={!input.trim() || isLoading}
        style={{
          width: '100%',
          padding: '16px',
          fontSize: '16px',
          fontWeight: '600',
          color: 'white',
          background: input.trim() && !isLoading ? '#3b82f6' : '#9ca3af',
          border: 'none',
          borderRadius: '12px',
          cursor: input.trim() && !isLoading ? 'pointer' : 'not-allowed',
          transition: 'background 0.2s',
          boxShadow: input.trim() && !isLoading 
            ? '0 4px 12px rgba(59, 130, 246, 0.4)' 
            : 'none',
        }}
      >
        {isLoading ? 'Adding...' : 'Add Concept'}
      </button>

      <div style={{
        marginTop: '32px',
        padding: '16px',
        background: '#f9fafb',
        borderRadius: '12px',
      }}>
        <div style={{ 
          fontSize: '14px', 
          fontWeight: '600', 
          marginBottom: '12px',
          color: '#374151',
        }}>
          💡 Tips
        </div>
        <ul style={{ 
          margin: 0, 
          paddingLeft: '20px',
          fontSize: '13px',
          color: '#6b7280',
          lineHeight: '1.8',
        }}>
          <li>Type a concept name like "Machine Learning"</li>
          <li>Paste a URL to create a resource link</li>
          <li>Press Enter to quickly add</li>
          <li>You can add descriptions and links later</li>
        </ul>
      </div>
    </div>
  );
}

