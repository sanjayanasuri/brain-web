'use client';

import { useEffect, useMemo, useState } from 'react';
import AppTopNav from '../components/layout/AppTopNav';
import {
  getAgentOpsState,
  getAgentOpsConfig,
  spawnAgentTask,
  steerAgentTask,
  killAgentTask,
  runAgentTick,
  updateIdeaStatus,
  type AgentRun,
  type AgentIdea,
  type AgentOpsConfig,
} from '../api/agent-ops';

function agentLabel(cmd: string | undefined): string {
  if (!cmd) return '—';
  if (cmd.includes('codex')) return 'Codex';
  if (cmd.includes('cursor')) return 'Cursor';
  if (cmd.includes('claude')) return 'Claude';
  return cmd.split(/\s/)[0] || '—';
}

export default function OpsPage() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [ideas, setIdeas] = useState<AgentIdea[]>([]);
  const [config, setConfig] = useState<AgentOpsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('frontend/app');
  const [desc, setDesc] = useState('');
  const [agent, setAgent] = useState<'auto' | 'codex' | 'cursor'>('auto');
  const [steerText, setSteerText] = useState('');
  const [steerSession, setSteerSession] = useState('');
  const [error, setError] = useState<string | null>(null);

  const activeRuns = useMemo(() => runs.filter(r => (r.status || '') === 'running'), [runs]);

  async function refresh() {
    const [state, cfg] = await Promise.all([getAgentOpsState(), getAgentOpsConfig()]);
    setRuns(state.runs || []);
    setIdeas(state.ideas || []);
    setConfig(cfg);
  }

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load ops state');
      } finally {
        if (live) setLoading(false);
      }
    })();
    const id = setInterval(() => {
      refresh().catch(() => {});
    }, 3000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="app-shell">
      <div className="app-container">
        <div className="page-header-row">
          <div>
            <div className="page-title">Agent Ops</div>
            <div className="page-subtitle">Live orchestration hub for spawned agents and queued ideas.</div>
          </div>
          <AppTopNav />
        </div>

        {config && (
          <div className="ui-card" style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontWeight: 600 }}>Orchestrator</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              CLIs: {config.available_clis.length ? config.available_clis.join(', ') : 'none detected'}
              {' · '}
              max concurrent: {config.max_concurrent}
              {' · '}
              routing: {config.routing}
            </div>
          </div>
        )}

        <div className="ui-card" style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontWeight: 600 }}>Spawn Task</div>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 220px' }}>
            <input className="ui-input" placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input className="ui-input" placeholder="Scope" value={scope} onChange={(e) => setScope(e.target.value)} />
          </div>
          <input className="ui-input" placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13 }}>Agent:</label>
            <select
              className="ui-input"
              value={agent}
              onChange={(e) => setAgent(e.target.value as 'auto' | 'codex' | 'cursor')}
              style={{ width: 'auto', minWidth: 100 }}
            >
              <option value="auto">Auto (router)</option>
              <option value="codex">Codex</option>
              <option value="cursor">Cursor</option>
            </select>
            <button className="ui-button" onClick={async () => {
              setError(null);
              await spawnAgentTask({ title, scope, desc, agent });
              setTitle('');
              setDesc('');
              await refresh();
            }}>Spawn</button>
            <button className="ui-button" onClick={async () => {
              setError(null);
              await runAgentTick();
              await refresh();
            }}>Run Tick</button>
          </div>
        </div>

        <div className="ui-card" style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontWeight: 600 }}>Live Runs ({activeRuns.length} running)</div>
          {loading ? (
            <div className="page-subtitle">Loading runs...</div>
          ) : runs.length === 0 ? (
            <div className="page-subtitle">No runs yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {runs.slice(0, 12).map((r, i) => (
                <div key={`${r.task_id || r.id || i}`} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: 'var(--surface)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{r.task_id || r.id}</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 6, background: 'var(--border)', color: 'var(--muted)' }}>
                        {agentLabel(r.agent_cmd)}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{r.status || 'unknown'}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{(r.description || '').split('\n')[0]}</div>
                  <div style={{ fontSize: 12, marginTop: 6 }}>Session: {r.tmux_session || '-'}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                    CI: {String((r as any)?.checks?.ciPassed ?? false)} · Mergeable: {String((r as any)?.checks?.mergeable ?? false)} · Approvals: {String((r as any)?.checks?.approvalsCount ?? 0)}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    {r.tmux_session && (
                      <>
                        <button className="ui-button" onClick={async () => { setSteerSession(r.tmux_session || ''); setSteerText(''); }}>Steer</button>
                        <button className="ui-button" onClick={async () => { await killAgentTask(r.tmux_session!); await refresh(); }}>Kill</button>
                      </>
                    )}
                    {r.pr_url && <a className="ui-button" href={r.pr_url} target="_blank" rel="noreferrer">PR</a>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="ui-card" style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontWeight: 600 }}>Queued Ideas</div>
          {ideas.length === 0 ? (
            <div className="page-subtitle">No ideas in queue.</div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {ideas.filter(i => i.status === 'proposed' || i.status === 'approved').slice(0, 10).map((it) => (
                <div key={it.id} style={{ fontSize: 13, border: '1px solid var(--border)', borderRadius: 8, padding: 8, background: 'var(--surface)' }}>
                  <strong>{it.title}</strong>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{it.status} · {it.suggested_scope || '-'}</div>
                  <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                    <button className="ui-button" onClick={async () => { await updateIdeaStatus(it.id, 'approved'); await refresh(); }}>Approve</button>
                    <button className="ui-button" onClick={async () => { await updateIdeaStatus(it.id, 'deferred'); await refresh(); }}>Defer</button>
                    <button className="ui-button" onClick={async () => { await updateIdeaStatus(it.id, 'denied'); await refresh(); }}>Deny</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {steerSession ? (
          <div className="ui-card" style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontWeight: 600 }}>Steer Session: {steerSession}</div>
            <input className="ui-input" value={steerText} onChange={(e) => setSteerText(e.target.value)} placeholder="Send instruction to running agent..." />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="ui-button" onClick={async () => {
                if (!steerText.trim()) return;
                await steerAgentTask(steerSession, steerText.trim());
                setSteerText('');
              }}>Send</button>
              <button className="ui-button" onClick={() => setSteerSession('')}>Close</button>
            </div>
          </div>
        ) : null}

        {error ? <div style={{ color: '#b91c1c', fontSize: 13 }}>{error}</div> : null}
      </div>
    </div>
  );
}
