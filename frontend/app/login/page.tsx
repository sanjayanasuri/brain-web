'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { APP_NAME, getLoginErrorMessage } from '../lib/authCopy';
import AuthFooter from '../components/auth/AuthFooter';

export default function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const router = useRouter();
    const searchParams = useSearchParams();
    const emailInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!error) emailInputRef.current?.focus();
    }, [error]);

    useEffect(() => {
        const reason = searchParams?.get('reason');
        if (reason === 'session_expired') setError(getLoginErrorMessage('session'));
    }, [searchParams]);

    const callbackUrl = useMemo(() => {
        const url = searchParams?.get('callbackUrl');
        if (!url || typeof url !== 'string') return '/home';
        try {
            const parsed = new URL(url, window.location.origin);
            if (parsed.origin !== window.location.origin) return '/home';
            return parsed.pathname || '/home';
        } catch {
            return '/home';
        }
    }, [searchParams]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');

        try {
            const result = await signIn('credentials', {
                email,
                password,
                redirect: false,
            });

            if (result?.error) {
                setError(getLoginErrorMessage(result.error));
                setIsLoading(false);
            } else {
                router.push(callbackUrl);
            }
        } catch {
            setError(getLoginErrorMessage('network'));
            setIsLoading(false);
        }
    };

    return (
        <div className="page-container">
            <div className="entry-bg" />

            <nav className="nav-minimal" style={{ justifyContent: 'space-between' }}>
                <Link href="/" className="logo-minimal" style={{ color: 'var(--ink)', fontWeight: 700, fontSize: '1rem' }}>
                    {APP_NAME}
                </Link>
                <Link href="/signup" style={{ color: 'var(--muted)', textDecoration: 'none', fontWeight: 600, fontSize: '13px' }}>
                    Create account
                </Link>
            </nav>

            <div className="auth-container">
                <div className="auth-card">
                    <div className="auth-header">
                        <h2 className="auth-title">Welcome back</h2>
                        <p className="auth-subtitle">Sign in to your {APP_NAME} account</p>
                    </div>

                    <form onSubmit={handleSubmit}>
                        {error && (
                            <div className="auth-error" role="alert" aria-live="assertive">
                                {error}
                            </div>
                        )}

                        <div className="entry-form-group">
                            <label className="entry-label" htmlFor="login-email">Email</label>
                            <input
                                id="login-email"
                                ref={emailInputRef}
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="entry-input"
                                placeholder="you@example.com"
                                autoComplete="email"
                                aria-invalid={!!error}
                            />
                        </div>

                        <div className="entry-form-group">
                            <label className="entry-label" htmlFor="login-password">Password</label>
                            <div className="entry-input-wrap">
                                <input
                                    id="login-password"
                                    type={showPassword ? 'text' : 'password'}
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="entry-input"
                                    placeholder="••••••••"
                                    autoComplete="current-password"
                                    aria-invalid={!!error}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword((v) => !v)}
                                    className="entry-password-toggle"
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    tabIndex={-1}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="explorer-btn explorer-btn--primary"
                            style={{ width: '100%', marginTop: '1rem', padding: '12px' }}
                        >
                            {isLoading ? 'Signing you in…' : 'Sign in'}
                        </button>
                    </form>

                        <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '13px', color: 'var(--muted)' }}>
                        <Link href="/forgot-password" style={{ color: 'var(--muted)', textDecoration: 'none' }}>Forgot password?</Link>
                        </div>
                        <div style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: '13px', color: 'var(--muted)' }}>
                        New? <Link href="/signup" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>Create account</Link>
                    </div>
                </div>
            </div>
            <AuthFooter />
        </div>
    );
}
