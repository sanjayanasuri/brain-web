'use client';

import React, { useState, useEffect } from 'react';
import { listExams, createExam, deleteExam, type ExamData } from '../../api-client';
import Button from '../ui/Button';
import GlassCard from '../ui/GlassCard';
import { Input, Select } from '../ui/Input';
import Badge from '../ui/Badge';

export default function ExamManager() {
  const [exams, setExams] = useState<ExamData[]>([]);
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
    return <div style={{ padding: '20px', color: 'var(--muted)', textAlign: 'center' }}>Loading exams...</div>;
  }

  return (
    <GlassCard style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--ink)', margin: 0 }}>
          Upcoming Exams
        </h2>
        <Button
          variant={showForm ? 'secondary' : 'primary'}
          size="sm"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? 'Cancel' : '+ Add Exam'}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} style={{
          padding: '20px',
          background: 'var(--surface)',
          borderRadius: '12px',
          marginBottom: '20px',
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}>
          <div>
            <Input
              label="Exam Title"
              placeholder="e.g., Biology Midterm"
              value={formData.title}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, title: e.target.value })}
              required
            />
          </div>

          <div>
            <Input
              type="datetime-local"
              label="Exam Date"
              value={formData.exam_date}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, exam_date: e.target.value })}
              required
            />
          </div>

          <div>
            <Input
              label="Domain"
              placeholder="e.g., Biology, Physics"
              value={formData.domain}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, domain: e.target.value })}
            />
          </div>

          <div>
            <Input
              label="Required Concepts (comma-separated)"
              placeholder="e.g., Thermodynamics, Entropy"
              value={formData.required_concepts}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, required_concepts: e.target.value })}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '4px' }}>
            <Button variant="ghost" type="button" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">
              Create Exam
            </Button>
          </div>
        </form>
      )}

      {exams.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--muted)' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>📅</div>
          <div style={{ fontSize: '13px' }}>No upcoming exams. Add one to get study recommendations.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {exams.sort((a, b) => a.days_until - b.days_until).map((exam) => (
            <div
              key={exam.exam_id}
              style={{
                padding: '16px',
                background: 'var(--surface)',
                borderRadius: '12px',
                border: '1px solid var(--border)',
                borderLeft: `4px solid ${exam.days_until <= 7 ? 'var(--error)' : 'var(--accent)'}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: '15px',
                    fontWeight: '700',
                    color: 'var(--ink)',
                    marginBottom: '4px',
                  }}>
                    {exam.title}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                    {exam.domain && (
                      <Badge variant="accent" size="sm">
                        {exam.domain}
                      </Badge>
                    )}
                    <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                      {new Date(exam.date).toLocaleDateString()}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span>📚</span>
                    <span>{exam.required_concepts.length} {exam.required_concepts.length === 1 ? 'concept' : 'concepts'} to study</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
                  <Badge variant={exam.days_until <= 7 ? 'error' : 'accent'} style={{ fontWeight: 700 }}>
                    {exam.days_until} {exam.days_until === 1 ? 'day' : 'days'} left
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(exam.exam_id)}
                    style={{
                      padding: '4px 8px',
                      fontSize: '11px',
                      height: 'auto',
                      color: 'var(--error)',
                      borderColor: 'rgba(239, 68, 68, 0.2)'
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

