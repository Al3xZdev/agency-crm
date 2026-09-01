import Link from 'next/link';

export const metadata = { title: 'Enlace expirado' };

/**
 * Client portal: session/link expired or revoked. Shares the /c/invalid
 * presentation idiom (centered settings-card + ti-link-off icon + primary
 * back link). Arabic-neutral, matches the Spanish client portal.
 */
export default function ExpiredLinkPage() {
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
          style={{ fontSize: 30, color: 'var(--amber)', marginBottom: 10 }}
        />
        <h3 style={{ marginTop: 0 }}>Este enlace expiró o fue revocado</h3>
        <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>
          Contactá a tu agencia para recibir uno nuevo.
        </p>
        <Link
          href="/"
          className="btn primary"
          style={{ display: 'inline-flex', marginTop: 18, textDecoration: 'none' }}
        >
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
