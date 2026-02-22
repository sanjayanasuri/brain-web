'use client';

import { useState } from 'react';
import { getApiHeaders } from '../../api/base';

interface StyleFeedbackFormProps {
  answerId: string;
  question: string;
  originalResponse: string;
  onSubmitted?: () => void;
}

/**
 * Component for submitting structured style feedback.
 * Matches the format: "Test1: [response] Test1 Feedback: [notes]"
 */
export default function StyleFeedbackForm({
  answerId,
  question,
  originalResponse,
  onSubmitted,
}: StyleFeedbackFormProps) {
  const [feedbackNotes, setFeedbackNotes] = useState('');
  const [userRewrittenVersion, setUserRewrittenVersion] = useState('');
  const [testLabel, setTestLabel] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [verbosity, setVerbosity] = useState('');
  const [questionPreference, setQuestionPreference] = useState('');
  const [humorPreference, setHumorPreference] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackNotes.trim()) {
      alert('Please provide feedback notes');
      return;
    }

    setIsSubmitting(true);
    try {
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
      const response = await fetch(`${API_BASE_URL}/feedback/style`, {
        method: 'POST',
        headers: await getApiHeaders(),
        body: JSON.stringify({
          answer_id: answerId,
          question,
          original_response: originalResponse,
          feedback_notes: feedbackNotes,
          user_rewritten_version: userRewrittenVersion.trim() || undefined,
          test_label: testLabel.trim() || undefined,
          verbosity: verbosity || undefined,
          question_preference: questionPreference || undefined,
          humor_preference: humorPreference || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to submit feedback');
      }

      setSubmitted(true);
      setFeedbackNotes('');
      setUserRewrittenVersion('');
      setTestLabel('');
      setVerbosity('');
      setQuestionPreference('');
      setHumorPreference('');
      
      if (onSubmitted) {
        onSubmitted();
      }
    } catch (error) {
      console.error('Error submitting style feedback:', error);
      alert('Failed to submit feedback. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div style={{ padding: '12px', background: '#f0f9ff', borderRadius: '8px', marginTop: '12px' }}>
        <p style={{ margin: 0, color: '#0369a1' }}>✓ Style feedback submitted! This will help improve future responses.</p>
        <button
          onClick={() => setSubmitted(false)}
          style={{
            marginTop: '8px',
            padding: '4px 8px',
            background: 'transparent',
            border: '1px solid #0369a1',
            borderRadius: '4px',
            color: '#0369a1',
            cursor: 'pointer',
          }}
        >
          Submit Another
        </button>
      </div>
    );
  }

  // If collapsed, show just a button to expand
  if (!isExpanded) {
    return (
      <div style={{ marginTop: '8px' }}>
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          style={{
            padding: '6px 12px',
            background: 'transparent',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '12px',
            color: '#6b7280',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span>+</span>
          <span>Style Feedback</span>
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: '16px', padding: '16px', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>
          Style Feedback (Help me learn your preferences)
        </h3>
        <button
          type="button"
          onClick={() => setIsExpanded(false)}
          style={{
            background: 'transparent',
            border: 'none',
            fontSize: '18px',
            color: '#6b7280',
            cursor: 'pointer',
            padding: '0',
            lineHeight: 1,
            width: '20px',
            height: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Collapse"
        >
          ×
        </button>
      </div>
      
      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 500 }}>
          Test Label (optional, e.g., &quot;Test1&quot;):
        </label>
        <input
          type="text"
          value={testLabel}
          onChange={(e) => setTestLabel(e.target.value)}
          placeholder="Test1"
          style={{
            width: '100%',
            padding: '6px 8px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            fontSize: '12px',
          }}
        />
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 500 }}>
          Feedback Notes (What you liked/disliked, what could be different):
        </label>
        <textarea
          value={feedbackNotes}
          onChange={(e) => setFeedbackNotes(e.target.value)}
          placeholder="I like this one. I think it's the right amount of information. I don't like the fact that there is an unnecessary transition there though..."
          required
          rows={4}
          style={{
            width: '100%',
            padding: '8px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 500 }}>
          Your Rewritten Version (optional - if you rewrote it):
        </label>
        <textarea
          value={userRewrittenVersion}
          onChange={(e) => setUserRewrittenVersion(e.target.value)}
          placeholder="React is a JavaScript library that helps you build user interfaces..."
          rows={4}
          style={{
            width: '100%',
            padding: '8px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 500 }}>
          Verbosity Signal (optional):
        </label>
        <select
          value={verbosity}
          onChange={(e) => setVerbosity(e.target.value)}
          style={{
            width: '100%',
            padding: '6px 8px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            fontSize: '12px',
            background: 'white',
          }}
        >
          <option value="">No explicit signal</option>
          <option value="too_short">Too short</option>
          <option value="too_verbose">Too verbose</option>
          <option value="just_right">Just right</option>
        </select>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 500 }}>
          Question Style Signal (optional):
        </label>
        <select
          value={questionPreference}
          onChange={(e) => setQuestionPreference(e.target.value)}
          style={{
            width: '100%',
            padding: '6px 8px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            fontSize: '12px',
            background: 'white',
          }}
        >
          <option value="">No explicit signal</option>
          <option value="more_questions">Ask more follow-up questions</option>
          <option value="fewer_questions">Ask fewer follow-up questions</option>
          <option value="ok">Current question style is fine</option>
        </select>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', fontWeight: 500 }}>
          Humor Signal (optional):
        </label>
        <select
          value={humorPreference}
          onChange={(e) => setHumorPreference(e.target.value)}
          style={{
            width: '100%',
            padding: '6px 8px',
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            fontSize: '12px',
            background: 'white',
          }}
        >
          <option value="">No explicit signal</option>
          <option value="more_humor">Use more humor</option>
          <option value="less_humor">Use less humor</option>
          <option value="ok">Current humor level is fine</option>
        </select>
      </div>

      <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '12px' }}>
        <strong>Original Response:</strong>
        <div style={{ marginTop: '4px', padding: '8px', background: '#f9fafb', borderRadius: '4px', maxHeight: '150px', overflow: 'auto' }}>
          {originalResponse.substring(0, 500)}
          {originalResponse.length > 500 ? '...' : ''}
        </div>
      </div>

      <button
        type="submit"
        disabled={isSubmitting || !feedbackNotes.trim()}
        style={{
          padding: '8px 16px',
          background: isSubmitting || !feedbackNotes.trim() ? '#d1d5db' : '#3b82f6',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          fontSize: '13px',
          fontWeight: 500,
          cursor: isSubmitting || !feedbackNotes.trim() ? 'not-allowed' : 'pointer',
        }}
      >
        {isSubmitting ? 'Submitting...' : 'Submit Style Feedback'}
      </button>
    </form>
  );
}
