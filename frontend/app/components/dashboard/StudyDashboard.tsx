'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface StudyTimeData {
  domain: string;
  hours: number;
  minutes: number;
  total_ms: number;
}

interface ExamData {
  exam_id: string;
  title: string;
  date: string;
  days_until: number;
  required_concepts: string[];
  domain?: string;
}

interface StudyRecommendation {
  concept_id: string;
  concept_name: string;
  priority: 'high' | 'medium' | 'low';
  reason: string;
  suggested_documents: Array<{
    document_id: string;
    title: string;
    section: string;
    url: string;
  }>;
  estimated_time_min: number;
}

interface ResumePoint {
  document_id: string;
  document_title: string;
  block_id?: string;
  segment_id?: string;
  concept_id?: string;
  last_accessed: string;
  document_type: string;
  url: string;
}

interface DashboardData {
  study_time_by_domain: StudyTimeData[];
  upcoming_exams: ExamData[];
  study_recommendations: StudyRecommendation[];
  resume_points: ResumePoint[];
  total_study_hours: number;
  days_looked_back: number;
}

import { getDashboardData, type DashboardData } from '../../api-client';

export default function StudyDashboard() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const dashboardData = await getDashboardData(7);
      setData(dashboardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'var(--error)';
      case 'medium':
        return 'var(--accent)';
      case 'low':
        return 'var(--muted)';
      default:
        return 'var(--muted)';
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
        Loading your study dashboard...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <p style={{ color: 'var(--error)', marginBottom: '16px' }}>
          {error || 'Failed to load dashboard'}
        </p>
        <button
          onClick={loadDashboardData}
          style={{
            padding: '8px 16px',
            background: 'var(--accent)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
      padding: '40px 24px',
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '40px' }}>
          <h1 style={{
            fontSize: '42px',
            fontWeight: '700',
            marginBottom: '8px',
            color: 'var(--ink)',
            background: 'linear-gradient(135deg, var(--accent) 0%, #8B5CF6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            Welcome back
          </h1>
          <p style={{
            fontSize: '18px',
            color: 'var(--muted)',
            marginBottom: '24px',
          }}>
            Here&apos;s your study overview and what to focus on next
          </p>
        </div>

        {/* Study Time Summary */}
        {data.study_time_by_domain.length > 0 && (
          <div style={{
            background: 'var(--panel)',
            borderRadius: '16px',
            padding: '24px',
            marginBottom: '32px',
            border: '1px solid var(--border)',
          }}>
            <h2 style={{
              fontSize: '20px',
              fontWeight: '600',
              marginBottom: '16px',
              color: 'var(--ink)',
            }}>
              Study Time (Last {data.days_looked_back} Days)
            </h2>
            <div style={{
              fontSize: '36px',
              fontWeight: '700',
              color: 'var(--accent)',
              marginBottom: '16px',
            }}>
              {data.total_study_hours.toFixed(1)} hours
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
              {data.study_time_by_domain.map((domain) => (
                <div
                  key={domain.domain}
                  style={{
                    padding: '12px 16px',
                    background: 'var(--surface)',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '4px' }}>
                    {domain.domain}
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: '600', color: 'var(--ink)' }}>
                    {domain.hours.toFixed(1)}h {domain.minutes}m
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upcoming Exams */}
        {data.upcoming_exams.length > 0 && (
          <div style={{
            background: 'var(--panel)',
            borderRadius: '16px',
            padding: '24px',
            marginBottom: '32px',
            border: '1px solid var(--border)',
          }}>
            <h2 style={{
              fontSize: '20px',
              fontWeight: '600',
              marginBottom: '16px',
              color: 'var(--ink)',
            }}>
              Upcoming Exams
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {data.upcoming_exams.map((exam) => (
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
                        fontSize: '18px',
                        fontWeight: '600',
                        color: 'var(--ink)',
                        marginBottom: '4px',
                      }}>
                        {exam.title}
                      </div>
                      {exam.domain && (
                        <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '8px' }}>
                          {exam.domain}
                        </div>
                      )}
                      {exam.required_concepts.length > 0 && (
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                          {exam.required_concepts.length} concepts to study
                        </div>
                      )}
                    </div>
                    <div style={{
                      padding: '8px 16px',
                      background: exam.days_until <= 7 ? 'var(--error)' : 'var(--accent)',
                      color: 'white',
                      borderRadius: '8px',
                      fontSize: '16px',
                      fontWeight: '600',
                      whiteSpace: 'nowrap',
                    }}>
                      {exam.days_until} {exam.days_until === 1 ? 'day' : 'days'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Study Recommendations */}
        {data.study_recommendations.length > 0 && (
          <div style={{
            background: 'var(--panel)',
            borderRadius: '16px',
            padding: '24px',
            marginBottom: '32px',
            border: '1px solid var(--border)',
          }}>
            <h2 style={{
              fontSize: '20px',
              fontWeight: '600',
              marginBottom: '16px',
              color: 'var(--ink)',
            }}>
              What to Study Next
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {data.study_recommendations.slice(0, 5).map((rec) => (
                <div
                  key={rec.concept_id}
                  style={{
                    padding: '16px',
                    background: 'var(--surface)',
                    borderRadius: '8px',
                    border: `2px solid ${getPriorityColor(rec.priority)}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: '18px',
                        fontWeight: '600',
                        color: 'var(--ink)',
                        marginBottom: '4px',
                      }}>
                        {rec.concept_name}
                      </div>
                      <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '8px' }}>
                        {rec.reason}
                      </div>
                      {rec.suggested_documents.length > 0 && (
                        <div style={{ marginTop: '12px' }}>
                          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px', fontWeight: '500' }}>
                            Suggested sections:
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {rec.suggested_documents.map((doc, idx) => (
                              <Link
                                key={idx}
                                href={doc.url}
                                style={{
                                  padding: '6px 12px',
                                  background: 'var(--panel)',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                  color: 'var(--accent)',
                                  textDecoration: 'none',
                                  border: '1px solid var(--border)',
                                }}
                              >
                                {doc.title} - {doc.section}
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div style={{
                      padding: '4px 12px',
                      background: getPriorityColor(rec.priority),
                      color: 'white',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                      marginLeft: '12px',
                    }}>
                      {rec.priority}
                    </div>
                  </div>
                  <div style={{
                    marginTop: '12px',
                    paddingTop: '12px',
                    borderTop: '1px solid var(--border)',
                    fontSize: '12px',
                    color: 'var(--muted)',
                  }}>
                    Estimated time: {rec.estimated_time_min} minutes
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Resume Points */}
        {data.resume_points.length > 0 && (
          <div style={{
            background: 'var(--panel)',
            borderRadius: '16px',
            padding: '24px',
            marginBottom: '32px',
            border: '1px solid var(--border)',
          }}>
            <h2 style={{
              fontSize: '20px',
              fontWeight: '600',
              marginBottom: '16px',
              color: 'var(--ink)',
            }}>
              Continue Where You Left Off
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {data.resume_points.map((point) => (
                <Link
                  key={point.document_id}
                  href={point.url}
                  style={{
                    padding: '16px',
                    background: 'var(--surface)',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    textDecoration: 'none',
                    color: 'inherit',
                    display: 'block',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--panel)';
                    e.currentTarget.style.borderColor = 'var(--accent)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--surface)';
                    e.currentTarget.style.borderColor = 'var(--border)';
                  }}
                >
                  <div style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: 'var(--ink)',
                    marginBottom: '4px',
                  }}>
                    {point.document_title}
                  </div>
                  <div style={{
                    fontSize: '12px',
                    color: 'var(--muted)',
                  }}>
                    {formatTimeAgo(point.last_accessed)}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {data.study_time_by_domain.length === 0 &&
         data.upcoming_exams.length === 0 &&
         data.study_recommendations.length === 0 &&
         data.resume_points.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '60px 24px',
            color: 'var(--muted)',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📚</div>
            <div style={{ fontSize: '20px', fontWeight: '600', marginBottom: '8px', color: 'var(--ink)' }}>
              Start studying to see your dashboard
            </div>
            <div style={{ fontSize: '14px', marginBottom: '24px' }}>
              View documents, take notes, and add exams to get personalized recommendations
            </div>
            <Link
              href="/lecture-studio"
              style={{
                display: 'inline-block',
                padding: '12px 24px',
                background: 'var(--accent)',
                color: 'white',
                borderRadius: '8px',
                textDecoration: 'none',
                fontWeight: '600',
              }}
            >
              Create Your First Lecture
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
