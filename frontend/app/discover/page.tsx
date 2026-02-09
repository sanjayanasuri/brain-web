'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import SessionDrawer from '../components/navigation/SessionDrawer';
import { fetchNewsByCategory } from '../api-client';

const CATEGORIES = [
    { id: 'tech', label: 'Tech', icon: '🔋' },
    { id: 'science', label: 'Science', icon: '🧪' },
    { id: 'culture', label: 'Art & Culture', icon: '🎨' },
    { id: 'sports', label: 'Sports', icon: '🏀' },
    { id: 'entertainment', label: 'Entertainment', icon: '🍿' },
];

export default function DiscoverPage() {
    const router = useRouter();
    const [activeCategory, setActiveCategory] = useState('tech');
    const [news, setNews] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadNews();
    }, [activeCategory]);

    async function loadNews() {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchNewsByCategory(activeCategory, 12);
            setNews(data.results);
        } catch (err) {
            console.error('Failed to load news:', err);
            setError('Failed to load fresh news. Please try again later.');
        } finally {
            setLoading(false);
        }
    }

    const handleChatWithNews = (title: string) => {
        // Redirect to home with a query to start a research chat
        router.push(`/home?query=${encodeURIComponent(`Tell me more about: ${title}`)}`);
    };

    return (
        <div className="flex h-screen overflow-hidden bg-[#0a0a0b]" style={{ color: 'white' }}>
            <SessionDrawer />
            <main className="flex-1 flex flex-col overflow-hidden">
                {/* News Header / Category Bar */}
                <header className="h-20 flex items-center justify-between px-8 border-b border-white/5 bg-[#0a0a0b]/80 backdrop-blur-xl z-10">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl">✨</span>
                        <h1 className="text-2xl font-bold tracking-tight">Discover</h1>
                    </div>

                    <nav className="flex items-center gap-2 p-1 bg-white/5 rounded-full border border-white/10 overflow-x-auto custom-scrollbar-hide whitespace-nowrap max-w-[60vw]">
                        {CATEGORIES.map((cat) => (
                            <button
                                key={cat.id}
                                onClick={() => setActiveCategory(cat.id)}
                                className={`flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium transition-all duration-300 flex-shrink-0 ${activeCategory === cat.id
                                    ? 'bg-white text-black shadow-lg scale-105'
                                    : 'text-white/60 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                <span>{cat.icon}</span>
                                {cat.label}
                            </button>
                        ))}
                    </nav>
                </header>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto px-8 py-10 custom-scrollbar">
                    <div className="max-w-7xl mx-auto">

                        {loading ? (
                            <div className="flex flex-col items-center justify-center py-20 gap-4">
                                <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                <p className="text-white/40 animate-pulse">Scanning the web for fresh insights...</p>
                            </div>
                        ) : error ? (
                            <div className="p-12 text-center bg-red-500/10 border border-red-500/20 rounded-3xl">
                                <p className="text-red-400 font-medium">{error}</p>
                                <button onClick={loadNews} className="mt-4 px-6 py-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors">Retry</button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                                {news.map((item, index) => (
                                    <div
                                        key={index}
                                        className="group relative flex flex-col bg-white/[0.03] border border-white/5 rounded-[32px] overflow-hidden hover:bg-white/[0.06] hover:border-white/10 transition-all duration-500 hover:-translate-y-1 cursor-pointer"
                                        onClick={() => handleChatWithNews(item.title)}
                                    >
                                        {/* Visual Card Background - Geometric Shapes or Placeholder */}
                                        <div className="h-48 w-full bg-gradient-to-br from-indigo-500/20 to-purple-500/10 flex items-center justify-center relative overflow-hidden">
                                            <div className="absolute inset-0 opacity-20 group-hover:scale-110 transition-transform duration-700"
                                                style={{ backgroundImage: `radial-gradient(circle at 20% 30%, var(--accent) 0%, transparent 70%)` }} />
                                            <span className="text-4xl filter grayscale group-hover:grayscale-0 transition-all duration-500 scale-125 group-hover:scale-150">
                                                {CATEGORIES.find(c => c.id === activeCategory)?.icon || '📰'}
                                            </span>
                                        </div>

                                        <div className="p-8 flex flex-col flex-1">
                                            <div className="flex items-center gap-2 mb-4">
                                                <span className="px-3 py-1 bg-white/10 rounded-full text-[10px] font-bold uppercase tracking-wider text-white/60">
                                                    {activeCategory}
                                                </span>
                                                <span className="text-white/20">•</span>
                                                <span className="text-[11px] text-white/40 uppercase tracking-widest font-medium">Recently</span>
                                            </div>

                                            <h3 className="text-xl font-bold leading-tight mb-4 group-hover:text-white transition-colors">
                                                {item.title}
                                            </h3>

                                            <p className="text-white/50 text-sm line-clamp-3 mb-6 leading-relaxed">
                                                {item.content || item.snippet || "Explore the impact and future details of this development through our research agent."}
                                            </p>

                                            <div className="mt-auto flex items-center justify-between">
                                                <div className="flex -space-x-2">
                                                    {[1, 2].map(i => (
                                                        <div key={i} className="w-6 h-6 rounded-full bg-white/10 border-2 border-[#0a0a0b] flex items-center justify-center text-[8px] font-bold">
                                                            {i === 1 ? 'R' : 'A'}
                                                        </div>
                                                    ))}
                                                </div>
                                                <button className="flex items-center gap-2 text-xs font-bold text-white/40 group-hover:text-white transition-colors">
                                                    RESEARCH <span className="opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Knowledge Gaps Section */}
                        {!loading && !error && (
                            <div className="mt-20 p-1 bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-pink-500/20 rounded-[40px]">
                                <div className="p-10 bg-[#0a0a0b] rounded-[39px] flex flex-col md:flex-row items-center justify-between gap-8 border border-white/5">
                                    <div className="flex-1">
                                        <h2 className="text-2xl font-bold mb-3 flex items-center gap-3">
                                            <span>🧠</span> Knowledge Gaps Detected
                                        </h2>
                                        <p className="text-white/50">Our AI has identified 5 conceptual areas in your graph that could benefit from the latest research trends.</p>
                                    </div>
                                    <button className="px-8 py-4 bg-white text-black rounded-full font-bold hover:scale-105 transition-transform">
                                        Resolve Gaps
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </main>

            <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 0px;
        }
        .custom-scrollbar {
          scrollbar-width: none;
        }
      `}</style>
        </div>
    );
}
