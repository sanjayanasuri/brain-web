import React from 'react';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
    className?: string;
    variant?: 'default' | 'hover' | 'flat' | 'interactive';
}

const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
    ({ children, className = '', variant = 'default', style, ...props }, ref) => {

        // Base styles
        const baseStyles: React.CSSProperties = {
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: '16px',
            padding: '24px',
            boxShadow: 'var(--shadow)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)', // Safari support
            transition: 'all 0.2s ease',
            color: 'var(--ink)'
        };

        // Variant overrides
        const variantStyles: Record<string, React.CSSProperties> = {
            default: {},
            hover: {
                cursor: 'pointer',
            },
            interactive: {
                cursor: 'pointer',
            },
            flat: {
                background: 'var(--surface)',
                boxShadow: 'none',
                backdropFilter: 'none',
            }
        };

        // Combine styles
        const combinedStyle = {
            ...baseStyles,
            ...variantStyles[variant],
            ...style,
        };

        return (
            <div
                ref={ref}
                style={combinedStyle}
                className={`glass-card ${variant === 'hover' || variant === 'interactive' ? 'glass-card--interactive' : ''} ${className}`}
                {...props}
            >
                {children}
                <style jsx>{`
          .glass-card--interactive:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
            border-color: var(--accent);
          }
        `}</style>
            </div>
        );
    }
);

GlassCard.displayName = 'GlassCard';

export default GlassCard;
