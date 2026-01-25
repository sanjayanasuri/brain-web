import React from 'react';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
    children: React.ReactNode;
    variant?: 'neutral' | 'accent' | 'outline' | 'success' | 'warning' | 'error';
    size?: 'sm' | 'md';
}

const Badge = ({
    children,
    variant = 'neutral',
    size = 'md',
    style,
    className = '',
    ...props
}: BadgeProps) => {

    const baseStyles: React.CSSProperties = {
        display: 'inline-flex',
        alignItems: 'center',
        fontWeight: 500,
        borderRadius: '6px',
        whiteSpace: 'nowrap',
        fontFamily: 'var(--font-body)',
    };

    const variantStyles: Record<string, React.CSSProperties> = {
        neutral: {
            background: 'rgba(156, 163, 175, 0.1)',
            color: 'var(--muted)',
        },
        accent: {
            background: 'rgba(37, 99, 235, 0.1)',
            color: 'var(--accent)',
        },
        success: {
            background: 'rgba(16, 185, 129, 0.1)',
            color: '#10b981',
        },
        warning: {
            background: 'rgba(245, 158, 11, 0.1)',
            color: '#f59e0b',
        },
        error: {
            background: 'rgba(239, 68, 68, 0.1)',
            color: '#ef4444',
        },
        outline: {
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--muted)',
        },
    };

    const sizeStyles: Record<string, React.CSSProperties> = {
        sm: {
            padding: '2px 6px',
            fontSize: '11px',
        },
        md: {
            padding: '4px 8px',
            fontSize: '12px',
        },
    };

    return (
        <span
            style={{
                ...baseStyles,
                ...variantStyles[variant],
                ...sizeStyles[size],
                ...style,
            }}
            className={className}
            {...props}
        >
            {children}
        </span>
    );
};

export default Badge;
