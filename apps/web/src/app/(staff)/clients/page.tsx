'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { apiJson } from '../../../lib/api';

interface ClientRow {
  id: string;
  name: string;
  contact: string | null;
}

export default function ClientsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [error, setError] = useState<string | null>(null);

  const clients = useQuery({
    queryKey: ['clients'],
    queryFn: () => apiJson<ClientRow[]>('/api/clients'),
  });

  const createClient = useMutation({
    mutationFn: (body: { name: string; contact?: string }) =>
      apiJson<{ id: string }>('/api/clients', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setError(null);
      setName('');
      setContact('');
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    createClient.mutate({ name, contact: contact || undefined });
  }

  if (clients.isError) {
    return <p role="alert">Could not load clients ({String(clients.error?.message)})</p>;
  }

  return (
    <>
      <h1>Clients</h1>
      <form onSubmit={onCreate} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          placeholder="Client name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: 8 }}
        />
        <input
          placeholder="Contact (optional)"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          style={{ padding: 8 }}
        />
        <button type="submit" disabled={createClient.isPending} style={{ padding: '8px 16px' }}>
          Add client
        </button>
      </form>
      {error && (
        <p role="alert" style={{ color: '#b00020' }}>
          {error}
        </p>
      )}
      {clients.isLoading ? (
        <p>Loading…</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {(clients.data ?? []).map((c) => (
            <li key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
              <Link href={`/clients/${c.id}`} style={{ fontWeight: 600 }}>
                {c.name}
              </Link>
              {c.contact && <span style={{ color: '#666' }}> · {c.contact}</span>}
            </li>
          ))}
        </ul>
      )}
      {clients.data && clients.data.length === 0 && <p>No clients yet — add the first one above.</p>}
    </>
  );
}
