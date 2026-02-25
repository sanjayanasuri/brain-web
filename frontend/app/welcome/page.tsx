'use client';

import React from 'react';
import Link from 'next/link';
import { Mic, Edit3, Keyboard } from 'lucide-react';
import { APP_NAME, AUTH_TAGLINE } from '../lib/authCopy';
import AuthFooter from '../components/auth/AuthFooter';

export default function WelcomePage() {
    return (
        <div className="page-container" style={{ justifyContent: 'center' }}>
            <div className="entry-bg">
                <div className="entry-viz">
                    <div className="viz-node animate-viz-drift" style={{ top: '20%', left: '15%', width: '12px', height: '12px' }} />
                    <div className="viz-node animate-viz-drift" style={{ top: '40%', left: '80%', width: '18px', height: '18px', animationDelay: '-2s' }} />
                    <div className="viz-node animate-viz-drift" style={{ top: '70%', left: '30%', width: '10px', height: '10px', animationDelay: '-5s' }} />
                    <div className="viz-node animate-viz-drift" style={{ top: '15%', left: '70%', width: '14px', height: '14px', animationDelay: '-8s' }} />
                </div>
            </div>

            <nav className="nav-minimal" style={{ justifyContent: 'space-between' }}>
                <Link href="/" className="logo-minimal" style={{ color: 'var(--ink)', fontWeight: 700, fontSize: '1rem' }}>
                    {APP_NAME}
                </Link>
                <Link href="/login" style={{ color: 'var(--muted)', textDecoration: 'none', fontWeight: 600, fontSize: '13px' }}>
                    Sign in
                </Link>
            </nav>

            <main className="hero-container" style={{ padding: '2rem' }}>
                <div className="symbol-container">
                    <svg style={{ position: 'absolute', width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.15 }}>
                        <line x1="50%" y1="0%" x2="50%" y2="50%" stroke="var(--accent)" strokeWidth="2" />
                        <line x1="50%" y1="50%" x2="0%" y2="85%" stroke="var(--accent)" strokeWidth="2" />
                        <line x1="50%" y1="50%" x2="100%" y2="85%" stroke="var(--accent)" strokeWidth="2" />
                    </svg>

                    <div className="system-orb" style={{ zIndex: 20 }}>
                        <div className="orb-ring" />
                        <div className="orb-core" />
                    </div>

                    <div className="symbol-node node-speech">
                        <Mic />
                    </div>
                    <div className="symbol-node node-writing">
                        <Edit3 />
                    </div>
                    <div className="symbol-node node-typing">
                        <Keyboard />
                    </div>
                </div>

                <h1 className="hero-title" style={{ fontSize: 'clamp(1.75rem, 5vw, 2.5rem)', marginBottom: '0.5rem' }}>
                    {APP_NAME}
                </h1>
                <div className="hero-cta-wrapper" style={{ marginTop: '2rem', flexDirection: 'column', gap: '1.5rem' }}>
                    <p style={{
                        fontFamily: 'var(--font-serif)',
                        fontSize: '14px',
                        color: 'var(--muted)',
                        fontWeight: 500,
                        letterSpacing: '0.02em',
                        opacity: 0.8,
                        margin: 0
                    }}>
                        {AUTH_TAGLINE}
                    </p>
                    <p style={{
                        fontFamily: 'var(--font-body)',
                        fontSize: '13px',
                        color: 'var(--muted)',
                        opacity: 0.7,
                        margin: 0
                    }}>
                        Your notes, voice, and ideas in one place.
                    </p>
                    <Link href="/signup" className="explorer-btn explorer-btn--primary" style={{ padding: '14px 48px', fontSize: '15px', textDecoration: 'none' }}>
                        Get started
                    </Link>
                </div>
            </main>

            <div style={{ height: '4rem' }} />
            <AuthFooter />
        </div>
    );
}
