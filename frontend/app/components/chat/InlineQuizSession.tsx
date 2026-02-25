'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { startStudySession, getNextTask, submitAttempt, endStudySession } from '../../api-client-study';

interface InlineQuizSessionProps {
  topic: string;
  graphId?: string;
  onClose: () => void;
}

type Phase = 'loading' | 'question' | 'feedback' | 'teaching' | 'summary' | 'error';

interface AttemptRecord {
  question: string;
  answer: string;
  score: number;
  feedback: string;
  gapConcepts: GapConcept[];
  rubricScores: Record<string, number>;
  taskType: string;
}

interface GapConcept {
  name: string;
  definition?: string;
}

export default function InlineQuizSession({ topic, graphId, onClose }: InlineQuizSessionProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskType, setTaskType] = useState('');
  const [answer, setAnswer] = useState('');
  const [currentFeedback, setCurrentFeedback] = useState<AttemptRecord | null>(null);
  const [history, setHistory] = useState<AttemptRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const answerRef = useRef<HTMLTextAreaElement>(null);

  const questionCount = history.length + (phase === 'question' ? 1 : 0);
  const avgScore = history.length > 0
    ? history.reduce((sum, h) => sum + h.score, 0) / history.length
    : 0;
  const allGaps = history.flatMap(h => h.gapConcepts);
  const uniqueGaps = Array.from(new Map(allGaps.map(g => [g.name, g])).values());

  const startQuiz = useCallback(async () => {
    try {
      setPhase('loading');
      setError(null);
      const session = await startStudySession(`Quiz me on ${topic}`, undefined, undefined, 'quiz');
      setSessionId(session.session_id);

      // initial_task may be nested under task_spec or flat
      const raw = session.initial_task;
      const initialTask = raw?.task_spec || raw;
      if (initialTask?.prompt) {
        setQuestion(initialTask.prompt);
        setTaskId(initialTask.task_id);
        setTaskType(initialTask.task_type || 'quiz');
        setPhase('question');
      } else {
        const resp = await getNextTask(session.session_id, 'quiz');
        const task = resp?.task_spec || resp;
        if (task?.prompt) {
          setQuestion(task.prompt);
          setTaskId(task.task_id);
          setTaskType(task.task_type || 'quiz');
          setPhase('question');
        } else {
          setPhase('summary');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to start quiz');
      setPhase('error');
    }
  }, [topic]);

  useEffect(() => {
    if (phase === 'loading' && !sessionId && !error) {
      startQuiz();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase === 'question' && answerRef.current) {
      answerRef.current.focus();
    }
  }, [phase]);

  const handleSubmitAnswer = async () => {
    if (!answer.trim() || !taskId || submitting) return;
    try {
      setSubmitting(true);
      const result = await submitAttempt(taskId, answer.trim());

      // Handle both flat and nested (evaluation wrapper) response formats
      const eval_ = result.evaluation || result;
      const score = eval_.composite_score ?? eval_.score_json?.overall ?? 0.5;
      const rawGaps = eval_.gap_concepts || [];
      const gapConcepts: GapConcept[] = rawGaps.map((g: any) =>
        typeof g === 'string' ? { name: g } : { name: g.name, definition: g.definition }
      );

      const record: AttemptRecord = {
        question,
        answer: answer.trim(),
        score,
        feedback: eval_.feedback_text || 'Keep practicing!',
        gapConcepts,
        rubricScores: eval_.score_json || {},
        taskType,
      };

      setCurrentFeedback(record);
      setHistory(prev => [...prev, record]);
      setAnswer('');

      if (score < 0.5 && gapConcepts.length > 0) {
        setPhase('teaching');
      } else {
        setPhase('feedback');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to submit answer');
      setPhase('error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleNextQuestion = async () => {
    if (!sessionId) return;
    try {
      setPhase('loading');
      const resp = await getNextTask(sessionId, 'quiz');
      const task = resp?.task_spec || resp;
      if (task?.prompt) {
        setQuestion(task.prompt);
        setTaskId(task.task_id);
        setTaskType(task.task_type || 'quiz');
        setPhase('question');
      } else {
        setPhase('summary');
      }
    } catch {
      setPhase('summary');
    }
  };

  const handleEnd = async () => {
    if (sessionId) {
      try { await endStudySession(sessionId); } catch { /* ignore */ }
    }
    if (history.length > 0) {
      setPhase('summary');
    } else {
      onClose();
    }
  };

  const scoreColor = (s: number) => s >= 0.7 ? '#22c55e' : s >= 0.4 ? '#f59e0b' : '#ef4444';
  const scoreEmoji = (s: number) => s >= 0.8 ? '🌟' : s >= 0.6 ? '👍' : s >= 0.4 ? '💡' : '📚';
  const taskTypeLabel = (t: string) => {
    const labels: Record<string, string> = {
      clarify: 'Explain', define_example: 'Define & Example', explain_back: 'Teach Back',
      compare: 'Compare', apply: 'Apply', predict: 'Predict', quiz: 'Quiz',
    };
    return labels[t] || t;
  };

  const rubricLabels: Record<string, string> = {
    grounding: 'Accuracy', coherence: 'Clarity', completeness: 'Completeness',
    transfer: 'Understanding', effort: 'Depth',
  };

  return (
    <div style={{
      background: 'var(--panel)',
      border: '2px solid var(--accent, #3b82f6)',
      borderRadius: '16px',
      padding: '20px',
      margin: '8px 0',
      boxShadow: '0 4px 20px rgba(37, 99, 235, 0.12)',
    }}>
      {/* Header with running score */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>🧠</span>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink)' }}>Quiz: {topic}</div>
            {history.length > 0 && (
              <div style={{ fontSize: '12px', color: 'var(--muted)', display: 'flex', gap: '8px', marginTop: '2px' }}>
                <span>Q{questionCount}</span>
                <span>·</span>
                <span style={{ color: scoreColor(avgScore) }}>Avg: {Math.round(avgScore * 100)}%</span>
                {uniqueGaps.length > 0 && <>
                  <span>·</span>
                  <span style={{ color: '#f59e0b' }}>{uniqueGaps.length} gap{uniqueGaps.length !== 1 ? 's' : ''}</span>
                </>}
              </div>
            )}
          </div>
        </div>
        <button onClick={handleEnd} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '18px', padding: '4px' }}>✕</button>
      </div>

      {/* Mastery progress bar */}
      {history.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '3px' }}>
            {history.map((h, i) => (
              <div key={i} style={{
                flex: 1, height: '6px', borderRadius: '3px',
                background: scoreColor(h.score),
                opacity: 0.8,
              }} title={`Q${i + 1}: ${Math.round(h.score * 100)}%`} />
            ))}
            {phase === 'question' && (
              <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: 'var(--border)' }} />
            )}
          </div>
        </div>
      )}

      {/* Loading */}
      {phase === 'loading' && (
        <div style={{ textAlign: 'center', padding: '24px', color: 'var(--muted)' }}>
          <div style={{ fontSize: '24px', marginBottom: '8px', animation: 'pulse 1.5s infinite' }}>🧠</div>
          <div style={{ fontSize: '14px' }}>Preparing your next question...</div>
        </div>
      )}

      {/* Error */}
      {phase === 'error' && (
        <div style={{ padding: '16px', background: 'rgba(239,68,68,0.06)', borderRadius: '12px', border: '1px solid rgba(239,68,68,0.2)' }}>
          <div style={{ fontSize: '13px', color: '#ef4444', marginBottom: '8px' }}>{error}</div>
          <button onClick={startQuiz} style={{ padding: '8px 16px', fontSize: '13px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
            Try Again
          </button>
        </div>
      )}

      {/* Question */}
      {phase === 'question' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent)', background: 'rgba(37,99,235,0.08)', padding: '3px 10px', borderRadius: '12px', textTransform: 'uppercase' }}>
              {taskTypeLabel(taskType)}
            </span>
          </div>
          <div style={{
            fontSize: '15px', color: 'var(--ink)', lineHeight: 1.7, marginBottom: '16px',
            padding: '14px 18px', background: 'var(--surface)', borderRadius: '12px',
            borderLeft: '4px solid var(--accent)',
          }}>
            {question}
          </div>
          <textarea
            ref={answerRef}
            value={answer}
            onChange={e => setAnswer(e.target.value)}
            placeholder="Type your answer... (Shift+Enter for new line)"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && answer.trim()) { e.preventDefault(); handleSubmitAnswer(); } }}
            style={{
              width: '100%', minHeight: '100px', padding: '14px', fontSize: '14px',
              border: '1px solid var(--border)', borderRadius: '12px',
              background: 'var(--surface)', color: 'var(--ink)',
              resize: 'vertical', outline: 'none', lineHeight: 1.6,
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Enter to submit</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleEnd} style={{ padding: '8px 16px', fontSize: '13px', background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: '8px', cursor: 'pointer' }}>
                End Quiz
              </button>
              <button
                onClick={handleSubmitAnswer}
                disabled={!answer.trim() || submitting}
                style={{
                  padding: '8px 20px', fontSize: '13px', fontWeight: 600,
                  background: answer.trim() ? 'var(--accent)' : 'var(--border)',
                  color: 'white', border: 'none', borderRadius: '8px',
                  cursor: answer.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                {submitting ? 'Evaluating...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Teaching moment — shown when score < 50% and there are gap concepts */}
      {phase === 'teaching' && currentFeedback && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
            <span style={{ fontSize: '28px' }}>📚</span>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink)' }}>Let's learn this together</div>
              <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Here's what you missed and why it matters</div>
            </div>
          </div>

          {/* The feedback */}
          <div style={{
            padding: '14px 18px', background: 'rgba(37,99,235,0.04)',
            borderRadius: '12px', border: '1px solid rgba(37,99,235,0.12)',
            fontSize: '14px', color: 'var(--ink)', lineHeight: 1.7, marginBottom: '14px',
          }}>
            {currentFeedback.feedback}
          </div>

          {/* Gap concepts as learning cards */}
          {currentFeedback.gapConcepts.length > 0 && (
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent)', marginBottom: '8px', textTransform: 'uppercase' }}>
                Key concepts to review
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {currentFeedback.gapConcepts.map((gap, i) => (
                  <div key={i} style={{
                    padding: '10px 14px', background: 'var(--surface)', borderRadius: '10px',
                    border: '1px solid var(--border)', display: 'flex', alignItems: 'start', gap: '10px',
                  }}>
                    <span style={{ fontSize: '16px', flexShrink: 0 }}>💡</span>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>{gap.name}</div>
                      {gap.definition && (
                        <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px', lineHeight: 1.5 }}>{gap.definition}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button onClick={handleEnd} style={{ padding: '8px 16px', fontSize: '13px', background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: '8px', cursor: 'pointer' }}>
              Done for now
            </button>
            <button onClick={handleNextQuestion} style={{ padding: '8px 20px', fontSize: '13px', fontWeight: 600, background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
              Try another question →
            </button>
          </div>
        </div>
      )}

      {/* Feedback — shown when score >= 50% */}
      {phase === 'feedback' && currentFeedback && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '14px' }}>
            <div style={{ position: 'relative', width: '56px', height: '56px', flexShrink: 0 }}>
              <svg viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)', width: '56px', height: '56px' }}>
                <path d="M18 2.5 a 15.5 15.5 0 0 1 0 31 a 15.5 15.5 0 0 1 0 -31" fill="none" stroke="var(--border)" strokeWidth="3" />
                <path d="M18 2.5 a 15.5 15.5 0 0 1 0 31 a 15.5 15.5 0 0 1 0 -31" fill="none" stroke={scoreColor(currentFeedback.score)} strokeWidth="3" strokeDasharray={`${currentFeedback.score * 97.5} 97.5`} strokeLinecap="round" />
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 700, color: scoreColor(currentFeedback.score) }}>
                {Math.round(currentFeedback.score * 100)}%
              </div>
            </div>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--ink)' }}>
                {scoreEmoji(currentFeedback.score)} {currentFeedback.score >= 0.8 ? 'Excellent!' : currentFeedback.score >= 0.6 ? 'Good work!' : 'Getting there!'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                {taskTypeLabel(currentFeedback.taskType)} · Q{history.length}
              </div>
            </div>
          </div>

          {/* Rubric dimension bars */}
          {Object.keys(currentFeedback.rubricScores).length > 1 && (
            <div style={{ marginBottom: '14px', padding: '12px 14px', background: 'var(--surface)', borderRadius: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {Object.entries(currentFeedback.rubricScores).map(([key, value]) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--muted)', width: '85px', flexShrink: 0, textAlign: 'right' }}>
                      {rubricLabels[key] || key}
                    </span>
                    <div style={{ flex: 1, height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${(value as number) * 100}%`, height: '100%', background: scoreColor(value as number), borderRadius: '3px', transition: 'width 0.5s ease' }} />
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: scoreColor(value as number), width: '32px', textAlign: 'right' }}>
                      {Math.round((value as number) * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Written feedback */}
          <div style={{
            fontSize: '14px', color: 'var(--ink)', lineHeight: 1.7,
            padding: '14px 18px', background: 'var(--surface)', borderRadius: '12px',
            marginBottom: '14px', borderLeft: `4px solid ${scoreColor(currentFeedback.score)}`,
          }}>
            {currentFeedback.feedback}
          </div>

          {/* Gap concepts (if any, even on good scores) */}
          {currentFeedback.gapConcepts.length > 0 && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
              {currentFeedback.gapConcepts.map((gap, i) => (
                <span key={i} style={{
                  fontSize: '12px', padding: '4px 10px', borderRadius: '12px',
                  background: 'rgba(245,158,11,0.1)', color: '#f59e0b', fontWeight: 500,
                  border: '1px solid rgba(245,158,11,0.2)',
                }}>
                  💡 {gap.name}
                </span>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button onClick={handleEnd} style={{ padding: '8px 16px', fontSize: '13px', background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: '8px', cursor: 'pointer' }}>
              End Quiz
            </button>
            <button onClick={handleNextQuestion} style={{ padding: '8px 20px', fontSize: '13px', fontWeight: 600, background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
              Next Question →
            </button>
          </div>
        </div>
      )}

      {/* Summary — shown at end of quiz */}
      {phase === 'summary' && (
        <div>
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <div style={{ fontSize: '40px', marginBottom: '8px' }}>{scoreEmoji(avgScore)}</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>Quiz Complete!</div>
            <div style={{ fontSize: '14px', color: 'var(--muted)' }}>
              {history.length} question{history.length !== 1 ? 's' : ''} · Average score: {Math.round(avgScore * 100)}%
            </div>
          </div>

          {/* Per-question results */}
          {history.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: '8px' }}>Results</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {history.map((h, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '8px 12px', background: 'var(--surface)', borderRadius: '8px',
                  }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: scoreColor(h.score), width: '40px' }}>
                      {Math.round(h.score * 100)}%
                    </span>
                    <div style={{ flex: 1, fontSize: '13px', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {h.question.slice(0, 80)}...
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--muted)', background: 'var(--panel)', padding: '2px 8px', borderRadius: '8px' }}>
                      {taskTypeLabel(h.taskType)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Gap concepts to review */}
          {uniqueGaps.length > 0 && (
            <div style={{ marginBottom: '16px', padding: '14px', background: 'rgba(245,158,11,0.05)', borderRadius: '12px', border: '1px solid rgba(245,158,11,0.15)' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#f59e0b', marginBottom: '8px' }}>
                📚 Concepts to strengthen ({uniqueGaps.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {uniqueGaps.map((gap, i) => (
                  <div key={i} style={{ fontSize: '13px', color: 'var(--ink)' }}>
                    <span style={{ fontWeight: 600 }}>{gap.name}</span>
                    {gap.definition && <span style={{ color: 'var(--muted)' }}> — {gap.definition}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Next steps */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={onClose} style={{ padding: '10px 20px', fontSize: '14px', background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: '10px', cursor: 'pointer' }}>
              Back to Chat
            </button>
            {uniqueGaps.length > 0 && (
              <button
                onClick={() => { onClose(); router.push('/explorer'); }}
                style={{ padding: '10px 20px', fontSize: '14px', background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: '10px', cursor: 'pointer' }}
              >
                🗺️ Review in Study Map
              </button>
            )}
            <button
              onClick={() => { setHistory([]); setPhase('loading'); setSessionId(null); }}
              style={{ padding: '10px 20px', fontSize: '14px', fontWeight: 600, background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer' }}
            >
              Quiz Me Again
            </button>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      `}</style>
    </div>
  );
}
