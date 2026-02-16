'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');

        try {
            console.log('[Login] Attempting sign-in with email:', email);
            const result = await signIn('credentials', {
                email,
                password,
                redirect: false,
            });

            console.log('[Login] Sign-in result:', result);

            if (result?.error) {
                console.error('[Login] Sign-in error:', result.error);
                setError(`Authentication failed: ${result.error}`);
                setIsLoading(false);
            } else {
                console.log('[Login] Sign-in successful, navigating to /home');
                router.push('/home');
            }
        } catch (err) {
            console.error('[Login] Unexpected error:', err);
            setError('Synchronization error.');
            setIsLoading(false);
        }
    };

    return (
        <div className="page-container">
            <div className="entry-bg" />

            <div className="auth-container">
                <div className="auth-card">
                    <div className="auth-header">
                        <h2 className="auth-title">Login</h2>
                    </div>

                    <form onSubmit={handleSubmit}>
                        {error && (
                            <div style={{ color: 'var(--academic-red)', fontSize: '13px', textAlign: 'center', marginBottom: '1.5rem', fontWeight: 600 }}>
                                {error}
                            </div>
                        )}

                        <div className="entry-form-group">
                            <label className="entry-label">Email</label>
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="entry-input"
                                placeholder="name@network.edu"
                            />
                        </div>

                        <div className="entry-form-group">
                            <label className="entry-label">Password</label>
                            <input
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="entry-input"
                                placeholder="••••••••"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="explorer-btn explorer-btn--primary"
                            style={{ width: '100%', marginTop: '1rem', padding: '12px' }}
                        >
                            {isLoading ? 'Verifying...' : 'Login'}
                        </button>
                    </form>

                    <div style={{ textAlign: 'center', marginTop: '2rem', fontSize: '13px', color: 'var(--muted)' }}>
                        New? <Link href="/signup" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>Register</Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
