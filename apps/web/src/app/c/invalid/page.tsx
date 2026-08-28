import Link from 'next/link';

export const metadata = { title: 'Invalid link' };

/**
 * The SINGLE generic failure page (PR5 restyle): unknown, expired and revoked
 * links all land here — deliberately indistinguishable. Same copy and
 * behavior, design-system styling.
 */
export default function InvalidLinkPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div className="settings-card" style={{ maxWidth: 440, width: '100%', textAlign: 'center' }}>
        <i
          className="ti ti-link-off"
          aria-hidden="true"
          style={{ fontSize: 30, color: 'var(--red)', marginBottom: 10 }}
        />
        <h3 style={{ marginTop: 0 }}>This link is not valid</h3>
        <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
          It may have expired or been revoked. Ask your account contact for a new one.
        </p>
        <Link
          href="/"
          className="btn primary"
          style={{ display: 'inline-flex', marginTop: 18, textDecoration: 'none' }}
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
