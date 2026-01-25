import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    isLoading?: boolean;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({
        children,
        className = '',
        variant = 'primary',
        size = 'md',
        isLoading = false,
        leftIcon,
        rightIcon,
        style,
        disabled,
        ...props
    }, ref) => {

        const baseStyles: React.CSSProperties = {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '8px',
            fontWeight: 500,
            fontFamily: 'var(--font-body)',
            cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            border: '1px solid transparent',
            gap: '8px',
            opacity: disabled || isLoading ? 0.6 : 1,
            outline: 'none',
        };

        const variantStyles: Record<string, React.CSSProperties> = {
            primary: {
                background: 'var(--accent)',
                color: '#ffffff',
                border: '1px solid var(--accent)',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
            },
            secondary: {
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--ink)',
                backgroundColor: 'var(--surface)',
            },
            ghost: {
                background: 'transparent',
                border: '1px solid transparent',
                color: 'var(--muted)',
            },
            danger: {
                background: 'rgba(239, 68, 68, 0.1)',
                color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.2)',
            },
        };

        const sizeStyles: Record<string, React.CSSProperties> = {
            sm: {
                height: '32px',
                padding: '0 12px',
                fontSize: '13px',
            },
            md: {
                height: '40px',
                padding: '0 16px',
                fontSize: '14px',
            },
            lg: {
                height: '48px',
                padding: '0 24px',
                fontSize: '16px',
            },
        };

        const combinedStyle = {
            ...baseStyles,
            ...variantStyles[variant],
            ...sizeStyles[size],
            ...style,
        };

        return (
            <button
                ref={ref}
                style={combinedStyle}
                className={`btn-${variant} ${className}`}
                disabled={disabled || isLoading}
                {...props}
            >
                {isLoading && (
                    <span className="spinner" />
                )}
                {!isLoading && leftIcon}
                {children}
                {!isLoading && rightIcon}

                <style jsx>{`
          .btn-primary:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
            filter: brightness(1.1);
          }
          .btn-secondary:hover:not(:disabled) {
            background: var(--border);
            color: var(--ink);
          }
          .btn-ghost:hover:not(:disabled) {
             background: rgba(0,0,0,0.05);
             color: var(--ink);
          }
          .btn-danger:hover:not(:disabled) {
            background: rgba(239, 68, 68, 0.2);
          }
          .spinner {
            width: 16px;
            height: 16px;
            border: 2px solid currentColor;
            border-bottom-color: transparent;
            border-radius: 50%;
            display: inline-block;
            box-sizing: border-box;
            animation: rotation 1s linear infinite;
          }
          @keyframes rotation {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
            </button>
        );
    }
);

Button.displayName = 'Button';

export default Button;
