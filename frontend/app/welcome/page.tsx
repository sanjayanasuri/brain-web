'use client';

import React from 'react';
import Link from 'next/link';
import { Mic, Edit3, Keyboard } from 'lucide-react';

export default function WelcomePage() {
    return (
        <div className="page-container" style={{ justifyContent: 'center' }}>
            {/* Official Graph Background */}
            <div className="entry-bg">
                <div className="entry-viz">
                    <div className="viz-node animate-viz-drift" style={{ top: '20%', left: '15%', width: '12px', height: '12px' }} />
                    <div className="viz-node animate-viz-drift" style={{ top: '40%', left: '80%', width: '18px', height: '18px', animationDelay: '-2s' }} />
                    <div className="viz-node animate-viz-drift" style={{ top: '70%', left: '30%', width: '10px', height: '10px', animationDelay: '-5s' }} />
                    <div className="viz-node animate-viz-drift" style={{ top: '15%', left: '70%', width: '14px', height: '14px', animationDelay: '-8s' }} />
                </div>
            </div>

            {/* Top Nav - Minimalist */}
            <nav className="nav-minimal" style={{ justifyContent: 'flex-end' }}>
                <Link href="/login"
                    style={{
                        color: 'var(--muted)',
                        textDecoration: 'none',
                        fontWeight: 600,
                        fontSize: '13px'
                    }}
                >
                    Sign In
                </Link>
            </nav>

            {/* Symbol-Driven Center Piece */}
            <main className="hero-container" style={{ padding: '2rem' }}>
                <div className="symbol-container">
                    {/* Connecting Paths (Static SVG for better control) */}
                    <svg style={{ position: 'absolute', width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.15 }}>
                        <line x1="50%" y1="0%" x2="50%" y2="50%" stroke="var(--accent)" strokeWidth="2" />
                        <line x1="50%" y1="50%" x2="0%" y2="85%" stroke="var(--accent)" strokeWidth="2" />
                        <line x1="50%" y1="50%" x2="100%" y2="85%" stroke="var(--accent)" strokeWidth="2" />
                    </svg>

                    {/* Center Orb */}
                    <div className="system-orb" style={{ zIndex: 20 }}>
                        <div className="orb-ring" />
                        <div className="orb-core" />
                    </div>

                    {/* Symbolic Triple Nodes */}
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

                <div className="hero-cta-wrapper" style={{ marginTop: '4rem', flexDirection: 'column', gap: '1.5rem' }}>
                    <p style={{
                        fontFamily: 'var(--font-serif)',
                        fontSize: '14px',
                        color: 'var(--muted)',
                        fontWeight: 500,
                        letterSpacing: '0.02em',
                        opacity: 0.7,
                        margin: 0
                    }}>
                        Unify your learning experience
                    </p>
                    <Link href="/signup" className="explorer-btn explorer-btn--primary" style={{ padding: '14px 64px', fontSize: '15px', textDecoration: 'none' }}>
                        Join
                    </Link>
                </div>
            </main>

            {/* Balance */}
            <div style={{ height: '4rem' }} />
        </div>
    );
}
