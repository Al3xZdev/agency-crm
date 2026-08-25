'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { apiJson } from '../../../../lib/api';

interface CreativeRow {
  id: string;
  title: string;
  kind: 'IMAGE' | 'VIDEO' | 'TEXT';
  status: string;
}

const KINDS = ['IMAGE', 'VIDEO', 'TEXT'] as const;

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const campaignId = params.id;
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('IMAGE');
  const [error, setError] = useState<string | null>(null);

  const creatives = useQuery({
    queryKey: ['creatives', campaignId],
    queryFn: () => apiJson<CreativeRow[]>(`/api/campaigns/${campaignId}/creatives`),
  });

  const createCreative = useMutation({
    mutationFn: (body: { title: string; kind: string }) =>
      apiJson<{ id: string }>(`/api/campaigns/${campaignId}/creatives`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setError(null);
      setTitle('');
      void queryClient.invalidateQueries({ queryKey: ['creatives', campaignId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    createCreative.mutate({ title, kind });
  }

  return (
    <>
      <h1>Creatives</h1>
      <p style={{ color: '#666' }}>
        New creatives start in <strong>DRAFT</strong>; upload the first version to send them to
        review.
      </p>
      <form onSubmit={onCreate} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          placeholder="Creative title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ padding: 8 }}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])} style={{ padding: 8 }}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button type="submit" disabled={createCreative.isPending} style={{ padding: '8px 16px' }}>
          Add creative
        </button>
      </form>
      {error && (
        <p role="alert" style={{ color: '#b00020' }}>
          {error}
        </p>
      )}
      {creatives.isLoading ? (
        <p>Loading…</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {(creatives.data ?? []).map((c) => (
            <li key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
              <span style={{ fontWeight: 600 }}>{c.title}</span>{' '}
              <span style={{ color: '#666' }}>
                · {c.kind} · {c.status}
              </span>{' '}
              <Link href={`/upload/${c.id}`}>Upload version</Link>
            </li>
          ))}
        </ul>
      )}
      {creatives.data && creatives.data.length === 0 && (
        <p>No creatives yet — add the first one above.</p>
      )}
      <p>
        <Link href={`/clients`}>Back to clients</Link>
      </p>
    </>
  );
}
