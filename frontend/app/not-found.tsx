import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px',
      background: 'var(--background)',
      color: 'var(--ink)',
    }}>
      <div style={{
        maxWidth: '600px',
        textAlign: 'center',
      }}>
        <h1 style={{
          fontSize: '32px',
          fontWeight: '600',
          marginBottom: '16px',
        }}>
          404
        </h1>
        <h2 style={{
          fontSize: '24px',
          fontWeight: '500',
          marginBottom: '16px',
        }}>
          Page Not Found
        </h2>
        <p style={{
          fontSize: '16px',
          marginBottom: '24px',
          color: 'var(--ink-secondary)',
        }}>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          style={{
            display: 'inline-block',
            padding: '12px 24px',
            fontSize: '14px',
            fontWeight: '500',
            background: 'var(--accent)',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '8px',
          }}
        >
          Go back home
        </Link>
      </div>
    </div>
  );
}
