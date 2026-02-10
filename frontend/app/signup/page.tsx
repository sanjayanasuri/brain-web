'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SignupPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const router = useRouter();

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
                setSuccess(true);
                setTimeout(() => router.push('/login'), 1500);
            } else {
                setError(data.detail || 'Initialization failed.');
            }
        } catch (err) {
            setError('Synchronization error.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="page-container">
            <div className="entry-bg" />

            <div className="auth-container">
                <div className="auth-card">
                    {success ? (
                        <div style={{ textAlign: 'center', color: 'var(--academic-green)', fontWeight: 600, padding: '2rem' }}>
                            Success. Rerouting...
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit}>
                            {error && (
                                <div style={{ color: 'var(--academic-red)', fontSize: '13px', textAlign: 'center', marginBottom: '1.5rem', fontWeight: 600 }}>
                                    {error}
                                </div>
                            )}

                            <div className="entry-form-group">
                                <label className="entry-label">Full Name</label>
                                <input
                                    type="text"
                                    required
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value)}
                                    className="entry-input"
                                    placeholder="Full name"
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
                                    placeholder="Min. 8 characters"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="explorer-btn explorer-btn--primary"
                                style={{ width: '100%', marginTop: '1rem', padding: '12px' }}
                            >
                                {isLoading ? 'Provisioning...' : 'Register'}
                            </button>
                        </form>
                    )}

                    <div style={{ textAlign: 'center', marginTop: '2rem', fontSize: '13px', color: 'var(--muted)' }}>
                        Already member? <Link href="/login" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>Sign In</Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
