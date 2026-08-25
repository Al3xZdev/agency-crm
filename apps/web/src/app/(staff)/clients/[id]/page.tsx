'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { apiJson } from '../../../../lib/api';

interface CampaignRow {
  id: string;
  name: string;
}

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const clientId = params.id;
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const campaigns = useQuery({
    queryKey: ['campaigns', clientId],
    queryFn: () => apiJson<CampaignRow[]>(`/api/clients/${clientId}/campaigns`),
  });

  const createCampaign = useMutation({
    mutationFn: (body: { name: string }) =>
      apiJson<{ id: string }>(`/api/clients/${clientId}/campaigns`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setError(null);
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['campaigns', clientId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    createCampaign.mutate({ name });
  }

  return (
    <>
      <p>
        <Link href="/clients">← Clients</Link>
      </p>
      <h1>Campaigns</h1>
      <form onSubmit={onCreate} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          placeholder="Campaign name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: 8 }}
        />
        <button type="submit" disabled={createCampaign.isPending} style={{ padding: '8px 16px' }}>
          Add campaign
        </button>
      </form>
      {error && (
        <p role="alert" style={{ color: '#b00020' }}>
          {error}
        </p>
      )}
      {campaigns.isLoading ? (
        <p>Loading…</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {(campaigns.data ?? []).map((c) => (
            <li key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
              <Link href={`/campaigns/${c.id}`} style={{ fontWeight: 600 }}>
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {campaigns.data && campaigns.data.length === 0 && (
        <p>No campaigns yet — add the first one above.</p>
      )}
    </>
  );
}
