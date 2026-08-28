'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';

/**
 * Staff login (slice 5a, restyled). The API marks login @Public — no CSRF
 * bootstrap needed; the response sets the session + CSRF cookie pair and
 * every later call picks the token up via apiFetch.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/auth/login', { method: 'POST', body: { email, password } });
      router.push('/clients');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No pudimos iniciar sesión. Revisá tus credenciales.');
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div style={{ width: 360 }}>
        <div className="brand" style={{ textAlign: 'center' }}>
          Agencia CRM
        </div>
        <div className="eyebrow" style={{ textAlign: 'center', marginBottom: 24 }}>
          proofing desk
        </div>
        <form className="modal" onSubmit={onSubmit} style={{ maxWidth: 360 }}>
          <h3>Iniciar sesión</h3>
          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="login-email">Correo</label>
            <input
              id="login-email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@agencia.com"
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">Contraseña</label>
            <input
              id="login-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="field-error">{error}</p>}
          <button type="submit" className="btn primary" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
            {busy ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </main>
  );
}