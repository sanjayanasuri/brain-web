'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import SessionDrawer from '../components/navigation/SessionDrawer';
import { getChatSessions, type ChatSession } from '../lib/chatSessions';
import { listGraphs, getGraphOverview, listSnapshots } from '../api-client';

export default function LibraryPage() {
    const router = useRouter();
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [stats, setStats] = useState({ sessions: 0, sources: 0, nodes: 0 });
    const [loading, setLoading] = useState(true);
    const [snapshots, setSnapshots] = useState<any[]>([]);

    useEffect(() => {
        loadLibraryData();
    }, []);

    async function loadLibraryData() {
        setLoading(true);
        try {
            // 1. Load Sessions
            const chats = getChatSessions();
            const sortedChats = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
            setSessions(sortedChats);

            // 2. Load Graph Stats
            const graphsData = await listGraphs();
            const activeGraphId = graphsData.active_graph_id || 'default';
            const overview = await getGraphOverview(activeGraphId, 1, 1); // Small fetch just for meta

            // 3. Load Snapshots
            const snapshotsData = await listSnapshots(5);
            setSnapshots(snapshotsData.snapshots);

            setStats({
                sessions: sortedChats.length,
                sources: 12, // Placeholder until sources API is ready
                nodes: overview.meta?.node_count || 0
            });
        } catch (err) {
            console.error('Failed to load library data:', err);
        } finally {
            setLoading(false);
        }
    }

    const handleResumeSession = (sessionId: string) => {
        localStorage.setItem('brainweb:currentChatSession', sessionId);
        router.push('/home');
    };

    return (
        <div className="flex h-screen overflow-hidden bg-[#0a0a0b]" style={{ color: 'white' }}>
            <SessionDrawer />
            <main className="flex-1 flex flex-col overflow-hidden">
                {/* Header */}
                <header className="h-20 flex items-center px-8 border-b border-white/5 bg-[#0a0a0b]/80 backdrop-blur-xl z-10">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl">📚</span>
                        <h1 className="text-2xl font-bold tracking-tight">Library</h1>
                    </div>
                </header>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto px-8 py-10 custom-scrollbar">
                    <div className="max-w-7xl mx-auto">

                        {/* Stats Dashboard */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                            {[
                                { label: 'Sessions', value: stats.sessions, icon: '💬', color: 'from-blue-500/20 to-cyan-500/10' },
                                { label: 'Sources', value: stats.sources, icon: '📄', color: 'from-purple-500/20 to-pink-500/10' },
                                { label: 'Graph Nodes', value: stats.nodes, icon: '🕸️', color: 'from-amber-500/20 to-orange-500/10' },
                            ].map((stat, i) => (
                                <div key={i} className={`p-8 rounded-[32px] bg-gradient-to-br ${stat.color} border border-white/5 hover:border-white/10 transition-all`}>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-2xl">{stat.icon}</span>
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Overview</span>
                                    </div>
                                    <div className="text-4xl font-bold tracking-tight mb-1">{stat.value}</div>
                                    <div className="text-sm font-medium text-white/60">{stat.label}</div>
                                </div>
                            ))}
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                            {/* Main Content - History */}
                            <div className="lg:col-span-2 space-y-12">
                                <section>
                                    <div className="flex items-center justify-between mb-6">
                                        <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
                                            Recent Research Sessions <span className="text-white/20 font-normal text-sm">{sessions.length}</span>
                                        </h2>
                                        <button className="text-xs font-bold text-white/40 hover:text-white transition-colors">VIEW ALL →</button>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4">
                                        {sessions.slice(0, 6).map((session) => (
                                            <div
                                                key={session.id}
                                                onClick={() => handleResumeSession(session.id)}
                                                className="group p-6 rounded-3xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] hover:border-white/10 transition-all cursor-pointer flex items-center justify-between"
                                            >
                                                <div className="flex-1 min-w-0 pr-6">
                                                    <h3 className="font-bold text-lg mb-1 truncate group-hover:text-blue-400 transition-colors">{session.title}</h3>
                                                    <div className="flex items-center gap-3 text-xs text-white/40 font-medium">
                                                        <span>{new Date(session.updatedAt).toLocaleDateString()}</span>
                                                        <span className="w-1 h-1 rounded-full bg-white/10" />
                                                        <span>{session.messages.length} messages</span>
                                                        {(session as any).activeGraphId && (
                                                            <>
                                                                <span className="w-1 h-1 rounded-full bg-white/10" />
                                                                <span className="px-2 py-0.5 bg-white/5 rounded-md border border-white/5">{(session as any).activeGraphId}</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">→</div>
                                                </div>
                                            </div>
                                        ))}

                                        {sessions.length === 0 && (
                                            <div className="p-12 text-center rounded-3xl border border-white/5 bg-white/[0.02] text-white/40">
                                                <div className="text-4xl mb-4">🌪️</div>
                                                <p>No research sessions found.</p>
                                                <button onClick={() => router.push('/home')} className="mt-4 text-sm font-bold text-white hover:underline underline-offset-4">START RESEARCHING</button>
                                            </div>
                                        )}
                                    </div>
                                </section>
                            </div>

                            {/* Sidebar Content - Snapshots & Saved */}
                            <div className="space-y-12">
                                <section>
                                    <h2 className="text-xl font-bold tracking-tight mb-6">Graph Snapshots</h2>
                                    <div className="space-y-3">
                                        {snapshots.map((snap, i) => (
                                            <div key={i} className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-all cursor-pointer">
                                                <h4 className="font-bold text-sm mb-1">{snap.name}</h4>
                                                <p className="text-[10px] text-white/40 font-medium uppercase tracking-wider">{new Date(snap.created_at).toLocaleDateString()}</p>
                                            </div>
                                        ))}
                                        {snapshots.length === 0 && (
                                            <div className="p-6 text-center text-xs text-white/20 border border-white/5 rounded-2xl bg-white/[0.01]">
                                                No snapshots yet. Save your exploration in the Explorer!
                                            </div>
                                        )}
                                    </div>
                                </section>

                                <section>
                                    <h2 className="text-xl font-bold tracking-tight mb-6">Saved Findings</h2>
                                    <div className="p-10 rounded-3xl border-2 border-dashed border-white/5 text-center">
                                        <span className="text-2xl mb-4 block">🔖</span>
                                        <p className="text-xs text-white/40 leading-relaxed font-medium">Your saved quotes, claims, and media extracts will be organized here for easy reference.</p>
                                        <button className="mt-6 text-[10px] font-bold tracking-widest text-white/60 hover:text-white uppercase">Sync Now</button>
                                    </div>
                                </section>
                            </div>
                        </div>
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
