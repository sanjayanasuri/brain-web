'use client';

import React from 'react';
import Link from 'next/link';
import Button from './components/ui/Button';
import GlassCard from './components/ui/GlassCard';

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#0a0a0a] font-outfit text-white overflow-hidden">

      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute -left-1/4 -top-1/4 h-[800px] w-[800px] rounded-full bg-blue-600/20 blur-[120px] animate-pulse-slow" />
        <div className="absolute -right-1/4 -bottom-1/4 h-[600px] w-[600px] rounded-full bg-purple-600/20 blur-[100px] animate-pulse-slow delay-1000" />
      </div>

      {/* Navigation */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-6 md:px-12 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/20 flex items-center justify-center">
            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span className="text-xl font-bold tracking-tight">BrainWeb</span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/login" className="text-sm font-medium text-gray-300 hover:text-white transition-colors">
            Log In
          </Link>
          <Link href="/signup">
            <Button variant="primary" style={{ padding: '8px 20px', borderRadius: '10px' }}>
              Sign Up
            </Button>
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">

        <GlassCard className="mb-8 inline-flex items-center gap-2 rounded-full px-4 py-1.5 border border-white/10 bg-white/5 backdrop-blur-md">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">v1.0 Now Live</span>
        </GlassCard>

        <h1 className="max-w-4xl text-5xl font-extrabold tracking-tight text-white md:text-7xl lg:text-8xl leading-none mb-6">
          Your Second Brain <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 animate-gradient-x">
            Augmented.
          </span>
        </h1>

        <p className="max-w-2xl text-lg text-gray-400 md:text-xl leading-relaxed mb-10">
          Turn your chaotic notes into a structured knowledge graph.
          Use AI to visualize connections, synthesize insights, and transform how you learn.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md">
          <Link href="/signup" className="flex-1">
            <Button variant="primary" style={{ width: '100%', padding: '16px', fontSize: '1.1rem', borderRadius: '14px' }}>
              Start for Free
            </Button>
          </Link>
          <Link href="/dashboard" className="flex-1">
            <Button variant="secondary" style={{ width: '100%', padding: '16px', fontSize: '1.1rem', borderRadius: '14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
              See Demo
            </Button>
          </Link>
        </div>

        {/* Feature Grid Mini Preview */}
        <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full">
          {[
            { title: 'Graph Visualization', desc: 'See your knowledge as a connected network, not a list.', icon: '🕸️' },
            { title: 'AI Synthesis', desc: 'Auto-summarize lectures into structured notes.', icon: '✨' },
            { title: 'Voice Agent', desc: 'Talk to your second brain naturally.', icon: '🎙️' },
          ].map((f, i) => (
            <div key={i} className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm hover:bg-white/10 transition-colors text-left group">
              <div className="text-3xl mb-4 group-hover:scale-110 transition-transform origin-left">{f.icon}</div>
              <h3 className="text-lg font-bold text-white mb-2">{f.title}</h3>
              <p className="text-sm text-gray-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-8 text-center text-sm text-gray-600">
        <p>&copy; {new Date().getFullYear()} BrainWeb. All rights reserved.</p>
      </footer>

      <style jsx global>{`
        @keyframes pulse-slow {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 0.3; transform: scale(1.05); }
        }
        .animate-pulse-slow {
          animation: pulse-slow 8s infinite ease-in-out;
        }
        .animate-gradient-x {
          background-size: 200% 200%;
          animation: gradient-x 6s ease infinite;
        }
        @keyframes gradient-x {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>
    </div>
  );
}
