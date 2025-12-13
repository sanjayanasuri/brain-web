'use client';

import React, { useState, useEffect } from 'react';

interface AnswerSummary {
  answer_id: string;
  question: string;
  raw_answer: string;
  created_at: string;
  has_feedback: boolean;
  has_revision: boolean;
}

interface AnswerDetail {
  answer: {
    answer_id: string;
    question: string;
    raw_answer: string;
    used_node_ids: string[];
    created_at: string;
  };
  feedback: Array<{
    rating: number;
    reason: string | null;
    created_at: string;
  }>;
  revisions: Array<{
    user_rewritten_answer: string;
    created_at: string;
  }>;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export default function DebugAnswersPage() {
  const [answers, setAnswers] = useState<AnswerSummary[]>([]);
  const [selectedAnswer, setSelectedAnswer] = useState<AnswerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAnswers();
  }, []);

  const loadAnswers = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/debug/answers/recent?limit=20`);
      if (!response.ok) {
        throw new Error(`Failed to load answers: ${response.statusText}`);
      }
      const data = await response.json();
      setAnswers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load answers');
    } finally {
      setLoading(false);
    }
  };

  const loadAnswerDetail = async (answerId: string) => {
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/debug/answers/${answerId}`);
      if (!response.ok) {
        throw new Error(`Failed to load answer detail: ${response.statusText}`);
      }
      const data = await response.json();
      setSelectedAnswer(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load answer detail');
    }
  };

  const formatTime = (isoString: string) => {
    if (!isoString) return 'Unknown';
    const date = new Date(isoString);
    return date.toLocaleString();
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '24px' }}>Debug: Answers</h1>
      
      {error && (
        <div style={{
          padding: '12px',
          marginBottom: '16px',
          background: '#fee',
          border: '1px solid #fcc',
          borderRadius: '4px',
          color: '#c00',
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Left: Answer list */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2>Recent Answers</h2>
            <button
              onClick={loadAnswers}
              style={{
                padding: '6px 12px',
                fontSize: '14px',
                border: '1px solid #ccc',
                borderRadius: '4px',
                background: 'white',
                cursor: 'pointer',
              }}
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <div style={{ padding: '24px', textAlign: 'center', color: '#666' }}>
              Loading...
            </div>
          ) : answers.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: '#666' }}>
              No answers found
            </div>
          ) : (
            <div style={{ border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', borderBottom: '1px solid #ddd' }}>
                    <th style={{ padding: '8px', textAlign: 'left', borderRight: '1px solid #ddd' }}>ID</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderRight: '1px solid #ddd' }}>Time</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderRight: '1px solid #ddd' }}>Question</th>
                    <th style={{ padding: '8px', textAlign: 'center', borderRight: '1px solid #ddd' }}>Feedback</th>
                    <th style={{ padding: '8px', textAlign: 'center' }}>Revision</th>
                  </tr>
                </thead>
                <tbody>
                  {answers.map((ans) => (
                    <tr
                      key={ans.answer_id}
                      onClick={() => loadAnswerDetail(ans.answer_id)}
                      style={{
                        cursor: 'pointer',
                        borderBottom: '1px solid #eee',
                        background: selectedAnswer?.answer.answer_id === ans.answer_id ? '#f0f8ff' : 'white',
                      }}
                      onMouseEnter={(e) => {
                        if (selectedAnswer?.answer.answer_id !== ans.answer_id) {
                          e.currentTarget.style.background = '#f9f9f9';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (selectedAnswer?.answer.answer_id !== ans.answer_id) {
                          e.currentTarget.style.background = 'white';
                        }
                      }}
                    >
                      <td style={{ padding: '8px', borderRight: '1px solid #ddd', fontFamily: 'monospace', fontSize: '11px' }}>
                        {ans.answer_id.substring(0, 16)}...
                      </td>
                      <td style={{ padding: '8px', borderRight: '1px solid #ddd' }}>
                        {formatTime(ans.created_at)}
                      </td>
                      <td style={{ padding: '8px', borderRight: '1px solid #ddd', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ans.question}
                      </td>
                      <td style={{ padding: '8px', borderRight: '1px solid #ddd', textAlign: 'center' }}>
                        {ans.has_feedback ? '✓' : '○'}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        {ans.has_revision ? '✓' : '○'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Answer detail */}
        <div>
          <h2>Answer Detail</h2>
          {selectedAnswer ? (
            <div style={{ border: '1px solid #ddd', borderRadius: '4px', padding: '16px' }}>
              <div style={{ marginBottom: '16px' }}>
                <strong>Question:</strong>
                <div style={{ marginTop: '4px', padding: '8px', background: '#f9f9f9', borderRadius: '4px' }}>
                  {selectedAnswer.answer.question}
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <strong>Original Answer:</strong>
                <div style={{ marginTop: '4px', padding: '8px', background: '#f9f9f9', borderRadius: '4px', whiteSpace: 'pre-wrap', maxHeight: '300px', overflow: 'auto' }}>
                  {selectedAnswer.answer.raw_answer}
                </div>
              </div>

              {selectedAnswer.feedback.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <strong>Feedback ({selectedAnswer.feedback.length}):</strong>
                  {selectedAnswer.feedback.map((fb, idx) => (
                    <div key={idx} style={{ marginTop: '4px', padding: '8px', background: fb.rating > 0 ? '#e8f5e9' : '#ffebee', borderRadius: '4px' }}>
                      <div>{fb.rating > 0 ? '👍' : '👎'} {fb.reason || 'No reason provided'}</div>
                      <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
                        {formatTime(fb.created_at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selectedAnswer.revisions.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <strong>Revisions ({selectedAnswer.revisions.length}):</strong>
                  {selectedAnswer.revisions.map((rev, idx) => (
                    <div key={idx} style={{ marginTop: '4px', padding: '8px', background: '#e3f2fd', borderRadius: '4px' }}>
                      <div style={{ whiteSpace: 'pre-wrap', maxHeight: '200px', overflow: 'auto' }}>
                        {rev.user_rewritten_answer}
                      </div>
                      <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
                        {formatTime(rev.created_at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selectedAnswer.feedback.length === 0 && selectedAnswer.revisions.length === 0 && (
                <div style={{ padding: '16px', textAlign: 'center', color: '#666' }}>
                  No feedback or revisions yet
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: '24px', textAlign: 'center', color: '#666', border: '1px solid #ddd', borderRadius: '4px' }}>
              Click an answer to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
