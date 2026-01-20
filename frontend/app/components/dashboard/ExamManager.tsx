'use client';

import React, { useState, useEffect } from 'react';

// Exam type is imported from api-client

import { listExams, createExam, deleteExam, type Exam } from '../../api-client';

export default function ExamManager() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    exam_date: '',
    assessment_type: 'exam',
    required_concepts: '',
    domain: '',
    description: '',
  });

  useEffect(() => {
    loadExams();
  }, []);

  const loadExams = async () => {
    try {
      setLoading(true);
      const data = await listExams(90);
      setExams(data);
    } catch (err) {
      console.error('Failed to load exams:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const concepts = formData.required_concepts
        .split(',')
        .map(c => c.trim())
        .filter(c => c.length > 0);

      await createExam({
        title: formData.title,
        exam_date: formData.exam_date,
        assessment_type: formData.assessment_type,
        required_concepts: concepts,
        domain: formData.domain || undefined,
        description: formData.description || undefined,
      });
      
      await loadExams();
      setShowForm(false);
      setFormData({
        title: '',
        exam_date: '',
        assessment_type: 'exam',
        required_concepts: '',
        domain: '',
        description: '',
      });
    } catch (err) {
      console.error('Failed to create exam:', err);
      alert('Failed to create exam. Please try again.');
    }
  };

  const handleDelete = async (examId: string) => {
    if (!confirm('Are you sure you want to delete this exam?')) return;
    
    try {
      await deleteExam(examId);
      await loadExams();
    } catch (err) {
      console.error('Failed to delete exam:', err);
      alert('Failed to delete exam. Please try again.');
    }
  };

  if (loading) {
    return <div style={{ padding: '20px', color: 'var(--muted)' }}>Loading exams...</div>;
  }

  return (
    <div style={{
      background: 'var(--panel)',
      borderRadius: '16px',
      padding: '24px',
      border: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: '600', color: 'var(--ink)' }}>
          Upcoming Exams
        </h2>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{
            padding: '8px 16px',
            background: 'var(--accent)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '600',
          }}
        >
          {showForm ? 'Cancel' : '+ Add Exam'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} style={{
          padding: '20px',
          background: 'var(--surface)',
          borderRadius: '8px',
          marginBottom: '20px',
          border: '1px solid var(--border)',
        }}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '500', color: 'var(--ink)' }}>
              Exam Title *
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '14px',
                background: 'var(--panel)',
                color: 'var(--ink)',
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '500', color: 'var(--ink)' }}>
              Exam Date *
            </label>
            <input
              type="datetime-local"
              value={formData.exam_date}
              onChange={(e) => setFormData({ ...formData, exam_date: e.target.value })}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '14px',
                background: 'var(--panel)',
                color: 'var(--ink)',
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '500', color: 'var(--ink)' }}>
              Domain (optional)
            </label>
            <input
              type="text"
              value={formData.domain}
              onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
              placeholder="e.g., Biology, Physics"
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '14px',
                background: 'var(--panel)',
                color: 'var(--ink)',
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '500', color: 'var(--ink)' }}>
              Required Concepts (comma-separated, optional)
            </label>
            <input
              type="text"
              value={formData.required_concepts}
              onChange={(e) => setFormData({ ...formData, required_concepts: e.target.value })}
              placeholder="e.g., Thermodynamics, Entropy, Heat Transfer"
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '14px',
                background: 'var(--panel)',
                color: 'var(--ink)',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                color: 'var(--ink)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                padding: '8px 16px',
                background: 'var(--accent)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600',
              }}
            >
              Create Exam
            </button>
          </div>
        </form>
      )}

      {exams.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📅</div>
          <div style={{ fontSize: '14px' }}>No upcoming exams. Add one to get study recommendations.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {exams.map((exam) => (
            <div
              key={exam.exam_id}
              style={{
                padding: '16px',
                background: exam.days_until <= 7 ? 'rgba(239, 68, 68, 0.1)' : 'var(--surface)',
                borderRadius: '8px',
                border: `1px solid ${exam.days_until <= 7 ? 'var(--error)' : 'var(--border)'}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: 'var(--ink)',
                    marginBottom: '4px',
                  }}>
                    {exam.title}
                  </div>
                  {exam.domain && (
                    <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                      {exam.domain}
                    </div>
                  )}
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    {new Date(exam.date).toLocaleDateString()} • {exam.required_concepts.length} concepts
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div style={{
                    padding: '6px 12px',
                    background: exam.days_until <= 7 ? 'var(--error)' : 'var(--accent)',
                    color: 'white',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '600',
                    whiteSpace: 'nowrap',
                  }}>
                    {exam.days_until} {exam.days_until === 1 ? 'day' : 'days'}
                  </div>
                  <button
                    onClick={() => handleDelete(exam.exam_id)}
                    style={{
                      padding: '6px 12px',
                      background: 'transparent',
                      color: 'var(--error)',
                      border: '1px solid var(--error)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
