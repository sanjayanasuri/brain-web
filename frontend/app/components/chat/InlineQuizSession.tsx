'use client';

import { useState, useCallback, useEffect } from 'react';
import { startStudySession, getNextTask, submitAttempt, endStudySession } from '../../api-client-study';

interface InlineQuizSessionProps {
  topic: string;
  graphId?: string;
  onClose: () => void;
}

type Phase = 'loading' | 'question' | 'answering' | 'feedback' | 'complete' | 'error';

export default function InlineQuizSession({ topic, graphId, onClose }: InlineQuizSessionProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<{ score: number; text: string } | null>(null);
  const [questionCount, setQuestionCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const startQuiz = useCallback(async () => {
    try {
      setPhase('loading');
      setError(null);
      const session = await startStudySession(`Quiz me on ${topic}`, undefined, undefined, 'quiz');
      setSessionId(session.session_id);

      const initialTask = session.initial_task;
      if (initialTask?.prompt) {
        setQuestion(initialTask.prompt);
        setTaskId(initialTask.task_id);
        setPhase('question');
        setQuestionCount(1);
      } else {
        const task = await getNextTask(session.session_id, 'quiz');
        if (task?.prompt) {
          setQuestion(task.prompt);
          setTaskId(task.task_id);
          setPhase('question');
          setQuestionCount(1);
        } else {
          setPhase('complete');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to start quiz');
      setPhase('error');
    }
  }, [topic]);

  const handleSubmitAnswer = async () => {
    if (!answer.trim() || !taskId || submitting) return;
    try {
      setSubmitting(true);
      const result = await submitAttempt(taskId, answer.trim());
      setFeedback({
        score: result.composite_score ?? result.score_json?.overall ?? 0.5,
        text: result.feedback_text || 'Good effort!',
      });
      setPhase('feedback');
      setAnswer('');
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
      const task = await getNextTask(sessionId, 'quiz');
      if (task?.prompt) {
        setQuestion(task.prompt);
        setTaskId(task.task_id);
        setPhase('question');
        setQuestionCount(prev => prev + 1);
      } else {
        setPhase('complete');
      }
    } catch {
      setPhase('complete');
    }
  };

  const handleEnd = async () => {
    if (sessionId) {
      try { await endStudySession(sessionId); } catch { /* ignore */ }
    }
    onClose();
  };

  // Auto-start on mount
  useEffect(() => {
    if (phase === 'loading' && !sessionId && !error) {
      startQuiz();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scoreColor = feedback ? (feedback.score >= 0.7 ? '#22c55e' : feedback.score >= 0.4 ? '#f59e0b' : '#ef4444') : '#999';

  return (
    <div style={{
      background: 'var(--panel)',
      border: '2px solid var(--accent, #3b82f6)',
      borderRadius: '16px',
      padding: '20px',
      margin: '8px 0',
      boxShadow: '0 4px 16px rgba(37, 99, 235, 0.1)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '18px' }}>🧠</span>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)' }}>
            Quiz: {topic}
          </span>
          {questionCount > 0 && (
            <span style={{ fontSize: '12px', color: 'var(--muted)', background: 'var(--surface)', padding: '2px 8px', borderRadius: '10px' }}>
              Q{questionCount}
            </span>
          )}
        </div>
        <button onClick={handleEnd} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '16px' }}>✕</button>
      </div>

      {phase === 'loading' && (
        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)', fontSize: '14px' }}>
          Preparing your quiz...
        </div>
      )}

      {phase === 'error' && (
        <div style={{ padding: '16px', background: 'rgba(239,68,68,0.08)', borderRadius: '10px', fontSize: '13px', color: '#ef4444' }}>
          {error}
          <div style={{ marginTop: '8px' }}>
            <button onClick={startQuiz} style={{ padding: '6px 12px', fontSize: '12px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
              Try Again
            </button>
          </div>
        </div>
      )}

      {(phase === 'question' || phase === 'answering') && (
        <div>
          <div style={{ fontSize: '15px', color: 'var(--ink)', lineHeight: 1.6, marginBottom: '16px', padding: '12px 16px', background: 'var(--surface)', borderRadius: '10px', borderLeft: '3px solid var(--accent)' }}>
            {question}
          </div>
          <textarea
            value={answer}
            onChange={e => setAnswer(e.target.value)}
            placeholder="Type your answer..."
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && answer.trim()) { e.preventDefault(); handleSubmitAnswer(); } }}
            style={{
              width: '100%',
              minHeight: '80px',
              padding: '12px',
              fontSize: '14px',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              background: 'var(--surface)',
              color: 'var(--ink)',
              resize: 'vertical',
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
            <button onClick={handleEnd} style={{ padding: '8px 16px', fontSize: '13px', background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: '8px', cursor: 'pointer' }}>
              End Quiz
            </button>
            <button
              onClick={handleSubmitAnswer}
              disabled={!answer.trim() || submitting}
              style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 600, background: answer.trim() ? 'var(--accent)' : 'var(--border)', color: 'white', border: 'none', borderRadius: '8px', cursor: answer.trim() ? 'pointer' : 'not-allowed' }}
            >
              {submitting ? 'Checking...' : 'Submit Answer'}
            </button>
          </div>
        </div>
      )}

      {phase === 'feedback' && feedback && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '50%',
              background: `conic-gradient(${scoreColor} ${feedback.score * 360}deg, var(--border) 0deg)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: 'var(--panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, color: scoreColor }}>
                {Math.round(feedback.score * 100)}%
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)' }}>
                {feedback.score >= 0.7 ? 'Great job!' : feedback.score >= 0.4 ? 'Getting there!' : 'Keep studying!'}
              </div>
            </div>
          </div>
          <div style={{ fontSize: '14px', color: 'var(--ink)', lineHeight: 1.6, padding: '12px 16px', background: 'var(--surface)', borderRadius: '10px', marginBottom: '12px' }}>
            {feedback.text}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button onClick={handleEnd} style={{ padding: '8px 16px', fontSize: '13px', background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: '8px', cursor: 'pointer' }}>
              Done
            </button>
            <button onClick={handleNextQuestion} style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 600, background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
              Next Question →
            </button>
          </div>
        </div>
      )}

      {phase === 'complete' && (
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>🎉</div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--ink)', marginBottom: '4px' }}>Quiz Complete!</div>
          <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '16px' }}>You answered {questionCount} question{questionCount !== 1 ? 's' : ''}.</div>
          <button onClick={handleEnd} style={{ padding: '10px 24px', fontSize: '14px', fontWeight: 600, background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer' }}>
            Back to Chat
          </button>
        </div>
      )}
    </div>
  );
}
