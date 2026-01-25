import React from 'react';

// Input Component
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
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
                <input
                    ref={ref}
                    style={{
                        height: '40px',
                        padding: '0 12px',
                        borderRadius: '8px',
                        border: error ? '1px solid #ef4444' : '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--ink)',
                        fontSize: '14px',
                        outline: 'none',
                        transition: 'border-color 0.2s, box-shadow 0.2s',
                        width: '100%',
                        ...style
                    }}
                    className={`ui-input ${className}`}
                    {...props}
                />
                {error && (
                    <span style={{ fontSize: '11px', color: '#ef4444' }}>{error}</span>
                )}
                <style jsx>{`
          .ui-input:focus {
            border-color: var(--accent) !important;
            box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
          }
          .ui-input::placeholder {
            color: var(--muted);
            opacity: 0.6;
          }
        `}</style>
            </div>
        );
    }
);

Input.displayName = 'Input';


// Select Component
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    label?: string;
    options?: { label: string; value: string | number }[];
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
    ({ label, options, children, style, className = '', ...props }, ref) => {
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
                <select
                    ref={ref}
                    style={{
                        height: '40px',
                        padding: '0 32px 0 12px', // Extra padding for arrow
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--ink)',
                        fontSize: '14px',
                        outline: 'none',
                        transition: 'border-color 0.2s, box-shadow 0.2s',
                        width: '100%',
                        appearance: 'none',
                        backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%236b7280%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")`,
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'right 12px top 50%',
                        backgroundSize: '10px auto',
                        ...style
                    }}
                    className={`ui-select ${className}`}
                    {...props}
                >
                    {options ? options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    )) : children}
                </select>
                <style jsx>{`
          .ui-select:focus {
            border-color: var(--accent) !important;
            box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
          }
        `}</style>
            </div>
        );
    }
);

Select.displayName = 'Select';
