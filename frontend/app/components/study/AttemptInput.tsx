// frontend/app/components/study/AttemptInput.tsx
/**
 * AttemptInput component - textarea for user response with submit button.
 * Phase 2: Handles user input for task attempts.
 */

'use client';

import { useState } from 'react';

interface AttemptInputProps {
    onSubmit: (responseText: string) => void;
    isLoading?: boolean;
    placeholder?: string;
    options?: string[]; // Added
}

export default function AttemptInput({
    onSubmit,
    isLoading = false,
    placeholder = "Type your response here...",
    options = [] // Added
}: AttemptInputProps) {
    const [responseText, setResponseText] = useState('');
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null); // Added

    const handleSubmit = () => {
        if (options.length > 0) {
            if (selectedIndex !== null && !isLoading) {
                onSubmit(options[selectedIndex]);
                setSelectedIndex(null);
            }
        } else if (responseText.trim() && !isLoading) {
            onSubmit(responseText.trim());
            setResponseText(''); // Clear after submit
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // Submit on Cmd/Ctrl + Enter
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
        }
    };

    const wordCount = responseText.trim().split(/\s+/).filter(w => w.length > 0).length;

    return (
        <div style={{
            background: 'white',
            border: '1px solid #e0e0e0',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '16px',
        }}>
            <div style={{
                fontSize: '13px',
                fontWeight: 600,
                color: '#2c3e50',
                marginBottom: '8px',
            }}>
                Your Response
            </div>

            {options.length > 0 ? (
                /* MCQ Options Selection */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                    {options.map((option, idx) => (
                        <button
                            key={idx}
                            onClick={() => setSelectedIndex(idx)}
                            disabled={isLoading}
                            style={{
                                padding: '12px 16px',
                                background: selectedIndex === idx ? '#3498db' : '#f8f9fa',
                                color: selectedIndex === idx ? 'white' : '#2c3e50',
                                border: `1px solid ${selectedIndex === idx ? '#2980b9' : '#dfe4ea'}`,
                                borderRadius: '8px',
                                fontSize: '14px',
                                textAlign: 'left',
                                cursor: isLoading ? 'not-allowed' : 'pointer',
                                transition: 'all 0.2s',
                                display: 'flex',
                                gap: '12px',
                                fontWeight: selectedIndex === idx ? 600 : 400,
                            }}
                        >
                            <span style={{
                                width: '24px',
                                height: '24px',
                                borderRadius: '50%',
                                background: selectedIndex === idx ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.05)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '12px',
                                fontWeight: 700,
                            }}>
                                {String.fromCharCode(65 + idx)}
                            </span>
                            {option}
                        </button>
                    ))}
                </div>
            ) : (
                /* Default Textarea */
                <textarea
                    value={responseText}
                    onChange={(e) => setResponseText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    disabled={isLoading}
                    style={{
                        width: '100%',
                        minHeight: '120px',
                        padding: '12px',
                        border: '1px solid #ddd',
                        borderRadius: '6px',
                        fontSize: '14px',
                        lineHeight: '1.6',
                        fontFamily: 'inherit',
                        resize: 'vertical',
                        outline: 'none',
                        transition: 'border-color 0.2s',
                    }}
                    onFocus={(e) => e.target.style.borderColor = '#3498db'}
                    onBlur={(e) => e.target.style.borderColor = '#ddd'}
                />
            )}

            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '8px',
            }}>
                <div style={{
                    fontSize: '12px',
                    color: '#7f8c8d',
                }}>
                    {options.length === 0 && (
                        <>
                            {wordCount} {wordCount === 1 ? 'word' : 'words'}
                            {!isLoading && ' • Cmd/Ctrl + Enter to submit'}
                        </>
                    )}
                </div>

                <button
                    onClick={handleSubmit}
                    disabled={isLoading || (options.length > 0 ? selectedIndex === null : !responseText.trim())}
                    style={{
                        padding: '8px 20px',
                        background: (isLoading || (options.length > 0 ? selectedIndex === null : !responseText.trim())) ? '#bdc3c7' : '#3498db',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: !responseText.trim() || isLoading ? 'not-allowed' : 'pointer',
                        transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => {
                        if (responseText.trim() && !isLoading) {
                            e.currentTarget.style.background = '#2980b9';
                        }
                    }}
                    onMouseLeave={(e) => {
                        if (responseText.trim() && !isLoading) {
                            e.currentTarget.style.background = '#3498db';
                        }
                    }}
                >
                    {isLoading ? 'Evaluating...' : 'Submit'}
                </button>
            </div>
        </div>
    );
}
