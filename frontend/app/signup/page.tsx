'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { Eye, EyeOff } from 'lucide-react';
import { APP_NAME, getSignupErrorMessage } from '../lib/authCopy';
import AuthFooter from '../components/auth/AuthFooter';

function normalizeDetail(detail: unknown): string | undefined {
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length > 0 && typeof detail[0]?.msg === 'string') return detail[0].msg;
    return undefined;
}

export default function SignupPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const router = useRouter();
    const nameInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!success && !error) nameInputRef.current?.focus();
    }, [success, error]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');

        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'}/auth/signup`, {
                method: 'POST',
                body: JSON.stringify({
                    email,
                    password,
                    full_name: fullName,
                }),
                headers: { "Content-Type": "application/json" }
            });

            const data = await res.json();

            if (res.ok) {
                const signInResult = await signIn('credentials', {
                    email,
                    password,
                    redirect: false,
                });
                if (signInResult?.error) {
                    setSuccess(true);
                    setTimeout(() => router.push('/login'), 1800);
                } else {
                    router.push('/home');
                }
            } else {
                setError(getSignupErrorMessage(normalizeDetail(data.detail)));
            }
        } catch {
            setError(getSignupErrorMessage('network'));
        } finally {
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
                <Link href="/login" style={{ color: 'var(--muted)', textDecoration: 'none', fontWeight: 600, fontSize: '13px' }}>
                    Sign in
                </Link>
            </nav>

            <div className="auth-container">
                <div className="auth-card">
                    {success ? (
                        <div className="auth-success-message">
                            You're all set. Taking you to sign in…
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit}>
                            <div className="auth-header">
                                <h2 className="auth-title">Create your account</h2>
                                <p className="auth-subtitle">Join {APP_NAME}</p>
                            </div>

                            {error && (
                                <div className="auth-error" role="alert">
                                    {error}
                                </div>
                            )}

                            <div className="entry-form-group">
                                <label className="entry-label">Full name</label>
                                <input
                                    type="text"
                                    required
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value)}
                                    className="entry-input"
                                    placeholder="How we'll address you"
                                    autoComplete="name"
                                />
                            </div>

                            <div className="entry-form-group">
                                <label className="entry-label">Email</label>
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="entry-input"
                                    placeholder="you@example.com"
                                    autoComplete="email"
                                />
                            </div>

                            <div className="entry-form-group">
                                <label className="entry-label" htmlFor="signup-password">Password</label>
                                <div className="entry-input-wrap">
                                    <input
                                        id="signup-password"
                                        type={showPassword ? 'text' : 'password'}
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="entry-input"
                                        placeholder="At least 8 characters"
                                        autoComplete="new-password"
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
                                {isLoading ? 'Creating account…' : 'Create account'}
                            </button>
                        </form>
                    )}

                    {!success && (
                        <div style={{ textAlign: 'center', marginTop: '2rem', fontSize: '13px', color: 'var(--muted)' }}>
                            Already have an account? <Link href="/login" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>Sign in</Link>
                        </div>
                    )}
                </div>
            </div>
            <AuthFooter />
        </div>
    );
}
