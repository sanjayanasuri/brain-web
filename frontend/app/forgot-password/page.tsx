'use client';

import Link from 'next/link';
import { APP_NAME } from '../lib/authCopy';
import AuthFooter from '../components/auth/AuthFooter';

export default function ForgotPasswordPage() {
  return (
    <div className="page-container">
      <div className="entry-bg" />

      <nav className="nav-minimal" style={{ justifyContent: 'space-between' }}>
        <Link href="/" className="logo-minimal" style={{ color: 'var(--ink)', fontWeight: 700, fontSize: '1rem' }}>
          {APP_NAME}
        </Link>
        <Link href="/login" style={{ color: 'var(--muted)', textDecoration: 'none', fontWeight: 600, fontSize: '13px' }}>
          Sign in
        </Link>
      </nav>

      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <h2 className="auth-title">Reset password</h2>
            <p className="auth-subtitle">Password reset is not available yet</p>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '14px', lineHeight: 1.5, marginBottom: '1.5rem' }}>
            If you’ve forgotten your password, contact your administrator or support to reset it. Once a reset flow is set up, you’ll be able to request a reset link here.
          </p>
          <Link href="/login" className="explorer-btn explorer-btn--primary" style={{ display: 'inline-block', padding: '12px 24px', fontSize: '14px', textDecoration: 'none' }}>
            Back to sign in
          </Link>
        </div>
      </div>
      <AuthFooter />
    </div>
  );
}
