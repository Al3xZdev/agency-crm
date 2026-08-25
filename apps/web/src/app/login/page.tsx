'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { apiJson } from '../../lib/api';

/**
 * Staff login (slice 5a). The API marks login @Public — no CSRF bootstrap
 * needed; the response sets the session + CSRF cookie pair and every later
 * call picks the token up via apiFetch.
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
      await apiJson('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      router.push('/clients');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: '80px auto', padding: 24 }}>
      <h1>Staff sign in</h1>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', padding: 8 }}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: '100%', padding: 8 }}
          />
        </label>
        {error && (
          <p role="alert" style={{ color: '#b00020', margin: 0 }}>
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} style={{ padding: '10px 0' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
