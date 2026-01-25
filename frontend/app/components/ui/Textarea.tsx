import React from 'react';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    label?: string;
    error?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ label, error, style, className = '', ...props }, ref) => {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
                {label && (
                    <label style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: 'var(--muted)',
                        marginLeft: '2px'
                    }}>
                        {label}
                    </label>
                )}
                <textarea
                    ref={ref}
                    style={{
                        minHeight: '80px',
                        padding: '12px',
                        borderRadius: '8px',
                        border: error ? '1px solid #ef4444' : '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--ink)',
                        fontSize: '14px',
                        outline: 'none',
                        transition: 'border-color 0.2s, box-shadow 0.2s',
                        width: '100%',
                        resize: 'vertical',
                        fontFamily: 'inherit',
                        ...style
                    }}
                    className={`ui-textarea ${className}`}
                    {...props}
                />
                {error && (
                    <span style={{ fontSize: '11px', color: '#ef4444' }}>{error}</span>
                )}
                <style jsx>{`
          .ui-textarea:focus {
            border-color: var(--accent) !important;
            box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
          }
          .ui-textarea::placeholder {
            color: var(--muted);
            opacity: 0.6;
          }
        `}</style>
            </div>
        );
    }
);

Textarea.displayName = 'Textarea';

export default Textarea;
