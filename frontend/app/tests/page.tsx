'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

interface Test {
  id: string;
  path: string;
  description: string;
  enabled: boolean;
}

interface TestSuite {
  id: string;
  label: string;
  description: string;
  tests: Test[];
}

interface TestResult {
  path: string;
  passed: boolean;
  output?: string | null;
  duration?: number | null;
}

interface TestRunResponse {
  results: TestResult[];
  success: boolean;
  total_tests: number;
  passed_tests: number;
  failed_tests: number;
}

export default function TestSuitePage() {
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTests, setSelectedTests] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [runResults, setRunResults] = useState<TestRunResponse | null>(null);
  const [expandedSuites, setExpandedSuites] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function loadManifest() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`${API_BASE_URL}/tests/manifest`);
        if (!response.ok) {
          throw new Error(`Failed to load test manifest: ${response.statusText}`);
        }
        const data = await response.json();
        setSuites(data.suites || []);
        // Expand all suites by default
        setExpandedSuites(new Set(data.suites?.map((s: TestSuite) => s.id) || []));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tests');
      } finally {
        setLoading(false);
      }
    }
    loadManifest();
  }, []);

  function toggleTestSelection(testPath: string) {
    setSelectedTests(prev => {
      const next = new Set(prev);
      if (next.has(testPath)) {
        next.delete(testPath);
      } else {
        next.add(testPath);
      }
      return next;
    });
  }

  function toggleSuiteSelection(suite: TestSuite, select: boolean) {
    setSelectedTests(prev => {
      const next = new Set(prev);
      suite.tests.forEach(test => {
        if (test.enabled) {
          if (select) {
            next.add(test.path);
          } else {
            next.delete(test.path);
          }
        }
      });
      return next;
    });
  }

  function toggleSuiteExpanded(suiteId: string) {
    setExpandedSuites(prev => {
      const next = new Set(prev);
      if (next.has(suiteId)) {
        next.delete(suiteId);
      } else {
        next.add(suiteId);
      }
      return next;
    });
  }

  async function runSelectedTests() {
    if (selectedTests.size === 0) {
      setError('Please select at least one test to run');
      return;
    }

    try {
      setRunning(true);
      setError(null);
      setRunResults(null);

      const response = await fetch(`${API_BASE_URL}/tests/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tests: Array.from(selectedTests),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(errorData.detail || `Failed to run tests: ${response.statusText}`);
      }

      const data: TestRunResponse = await response.json();
      setRunResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run tests');
    } finally {
      setRunning(false);
    }
  }

  async function runSuite(suiteId: string) {
    try {
      setRunning(true);
      setError(null);
      setRunResults(null);

      const response = await fetch(`${API_BASE_URL}/tests/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          suite_ids: [suiteId],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(errorData.detail || `Failed to run tests: ${response.statusText}`);
      }

      const data: TestRunResponse = await response.json();
      setRunResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run tests');
    } finally {
      setRunning(false);
    }
  }

  function selectAllTests() {
    const allTests = new Set<string>();
    suites.forEach(suite => {
      suite.tests.forEach(test => {
        if (test.enabled) {
          allTests.add(test.path);
        }
      });
    });
    setSelectedTests(allTests);
  }

  function clearSelection() {
    setSelectedTests(new Set());
  }

  const allSelected = suites.every(suite =>
    suite.tests.filter(t => t.enabled).every(t => selectedTests.has(t.path))
  ) && selectedTests.size > 0;

  if (loading) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <p style={{ color: 'var(--muted)' }}>Loading test manifest...</p>
      </div>
    );
  }

  return (
    <div style={{ 
      minHeight: '100vh',
      padding: '24px',
      maxWidth: '1400px',
      margin: '0 auto',
    }}>
      <style jsx>{`
        .test-card {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 24px;
          box-shadow: var(--shadow);
        }
        .suite-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 16px;
          cursor: pointer;
        }
        .suite-title {
          font-size: 20px;
          font-weight: 700;
          color: var(--ink);
          margin-bottom: 4px;
        }
        .suite-description {
          color: var(--muted);
          font-size: 14px;
          line-height: 1.5;
        }
        .test-item {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 12px;
          border: 1px solid var(--border);
          border-radius: 8px;
          margin-bottom: 8px;
          background: white;
          transition: all 0.2s;
        }
        .test-item:hover {
          border-color: var(--accent);
          background: rgba(17, 138, 178, 0.02);
        }
        .test-item.disabled {
          opacity: 0.5;
        }
        .test-checkbox {
          margin-top: 2px;
          cursor: pointer;
        }
        .test-info {
          flex: 1;
        }
        .test-id {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 13px;
          color: var(--ink);
          font-weight: 500;
          margin-bottom: 4px;
        }
        .test-description {
          font-size: 13px;
          color: var(--muted);
          line-height: 1.5;
        }
        .button {
          padding: 10px 20px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          font-family: 'Space Grotesk', sans-serif;
        }
        .button-primary {
          background: var(--accent);
          color: white;
        }
        .button-primary:hover:not(:disabled) {
          background: #0d6b85;
        }
        .button-secondary {
          background: var(--panel);
          border: 1px solid var(--border);
          color: var(--ink);
        }
        .button-secondary:hover:not(:disabled) {
          background: rgba(17, 138, 178, 0.08);
        }
        .button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .results-panel {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 24px;
          margin-top: 32px;
          box-shadow: var(--shadow);
        }
        .results-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }
        .results-stats {
          display: flex;
          gap: 16px;
          margin-bottom: 16px;
        }
        .stat {
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
        }
        .stat-passed {
          background: rgba(34, 197, 94, 0.1);
          color: #16a34a;
        }
        .stat-failed {
          background: rgba(239, 71, 111, 0.1);
          color: var(--accent-2);
        }
        .stat-total {
          background: rgba(17, 138, 178, 0.1);
          color: var(--accent);
        }
        .output-panel {
          background: #1e293b;
          color: #e2e8f0;
          padding: 16px;
          border-radius: 8px;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          line-height: 1.6;
          max-height: 400px;
          overflow-y: auto;
          white-space: pre-wrap;
          word-break: break-all;
        }
        .expand-icon {
          transition: transform 0.2s;
        }
        .expand-icon.expanded {
          transform: rotate(90deg);
        }
      `}</style>

      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h1 style={{ fontSize: '32px', fontWeight: 700, color: 'var(--ink)', marginBottom: '8px' }}>
              Test Suite
            </h1>
            <p style={{ color: 'var(--muted)', fontSize: '14px' }}>
              Run and monitor backend pytest tests by feature area
            </p>
          </div>
          <Link href="/" style={{ 
            padding: '10px 20px',
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            color: 'var(--ink)',
            textDecoration: 'none',
            fontSize: '14px',
            fontWeight: 600,
          }}>
            ← Back to Graph
          </Link>
        </div>

        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
          <button
            className="button button-primary"
            onClick={runSelectedTests}
            disabled={running || selectedTests.size === 0}
          >
            {running ? 'Running...' : `Run Selected (${selectedTests.size})`}
          </button>
          <button
            className="button button-secondary"
            onClick={selectAllTests}
            disabled={running}
          >
            Select All
          </button>
          <button
            className="button button-secondary"
            onClick={clearSelection}
            disabled={running}
          >
            Clear Selection
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          background: 'rgba(239, 71, 111, 0.1)',
          border: '1px solid var(--accent-2)',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '24px',
          color: 'var(--accent-2)',
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {suites.map(suite => {
        const suiteTestsSelected = suite.tests.filter(t => t.enabled && selectedTests.has(t.path)).length;
        const suiteTestsTotal = suite.tests.filter(t => t.enabled).length;
        const isExpanded = expandedSuites.has(suite.id);

        return (
          <div key={suite.id} className="test-card">
            <div className="suite-header" onClick={() => toggleSuiteExpanded(suite.id)}>
              <div style={{ flex: 1 }}>
                <div className="suite-title">
                  {suite.label}
                  <span style={{ 
                    marginLeft: '12px',
                    fontSize: '14px',
                    fontWeight: 400,
                    color: 'var(--muted)',
                  }}>
                    ({suiteTestsSelected}/{suiteTestsTotal} selected)
                  </span>
                </div>
                <div className="suite-description">{suite.description}</div>
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <button
                  className="button button-secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    runSuite(suite.id);
                  }}
                  disabled={running}
                  style={{ fontSize: '12px', padding: '8px 16px' }}
                >
                  Run Suite
                </button>
                <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`} style={{ fontSize: '20px', color: 'var(--muted)' }}>
                  ▶
                </span>
              </div>
            </div>

            {isExpanded && (
              <div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <button
                    className="button button-secondary"
                    onClick={() => toggleSuiteSelection(suite, true)}
                    disabled={running}
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    Select All in Suite
                  </button>
                  <button
                    className="button button-secondary"
                    onClick={() => toggleSuiteSelection(suite, false)}
                    disabled={running}
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                  >
                    Deselect All
                  </button>
                </div>

                {suite.tests.map(test => (
                  <div
                    key={test.id}
                    className={`test-item ${!test.enabled ? 'disabled' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedTests.has(test.path)}
                      onChange={() => toggleTestSelection(test.path)}
                      disabled={!test.enabled || running}
                      className="test-checkbox"
                    />
                    <div className="test-info">
                      <div className="test-id">{test.id}</div>
                      <div className="test-description">{test.description}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {runResults && (
        <div className="results-panel">
          <div className="results-header">
            <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--ink)' }}>
              Test Results
            </h2>
            <div style={{
              padding: '6px 12px',
              borderRadius: '6px',
              background: runResults.success ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 71, 111, 0.1)',
              color: runResults.success ? '#16a34a' : 'var(--accent-2)',
              fontSize: '14px',
              fontWeight: 600,
            }}>
              {runResults.success ? '✓ All Passed' : '✗ Some Failed'}
            </div>
          </div>

          <div className="results-stats">
            <div className="stat stat-total">
              Total: {runResults.total_tests}
            </div>
            <div className="stat stat-passed">
              Passed: {runResults.passed_tests}
            </div>
            <div className="stat stat-failed">
              Failed: {runResults.failed_tests}
            </div>
          </div>

          {runResults.results.map((result, idx) => (
            <div key={idx} style={{ marginBottom: '16px' }}>
              <div style={{
                padding: '12px',
                background: result.passed ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 71, 111, 0.05)',
                border: `1px solid ${result.passed ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 71, 111, 0.2)'}`,
                borderRadius: '8px',
                marginBottom: '8px',
              }}>
                <div style={{
                  fontFamily: 'IBM Plex Mono, monospace',
                  fontSize: '12px',
                  color: 'var(--ink)',
                  marginBottom: '4px',
                }}>
                  {result.path}
                </div>
                <div style={{
                  fontSize: '13px',
                  color: result.passed ? '#16a34a' : 'var(--accent-2)',
                  fontWeight: 600,
                }}>
                  {result.passed ? '✓ Passed' : '✗ Failed'}
                </div>
              </div>
              {result.output && (
                <details style={{ marginTop: '8px' }}>
                  <summary style={{
                    cursor: 'pointer',
                    color: 'var(--muted)',
                    fontSize: '13px',
                    marginBottom: '8px',
                  }}>
                    View Output
                  </summary>
                  <div className="output-panel">{result.output}</div>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
