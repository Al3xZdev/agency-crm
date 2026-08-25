'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { apiJson } from '../../../../lib/api';

interface CreativeDetail {
  id: string;
  title: string;
  kind: 'IMAGE' | 'VIDEO' | 'TEXT';
  status: string;
  campaignId: string;
}

interface VersionRow {
  id: string;
  versionNo: number;
  state: string;
  reviewStatus: string;
  createdAt: string;
}

export default function CreativeDetailPage() {
  const params = useParams<{ id: string }>();
  const creativeId = params.id;

  const creative = useQuery({
    queryKey: ['creative', creativeId],
    queryFn: () => apiJson<CreativeDetail>(`/api/creatives/${creativeId}`),
  });

  const versions = useQuery({
    queryKey: ['versions', creativeId],
    queryFn: () => apiJson<VersionRow[]>(`/api/creatives/${creativeId}/versions`),
    enabled: !!creativeId,
  });

  if (creative.isLoading) return <p>Loading…</p>;
  if (creative.isError) {
    return (
      <p role="alert">
        Creative not found. <Link href="/clients">Back to clients</Link>
      </p>
    );
  }

  const c = creative.data!;

  return (
    <>
      <h1>{c.title}</h1>
      <p style={{ color: '#666' }}>
        {c.kind} · {c.status}
      </p>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        <Link href={`/upload/${c.id}`} style={{ padding: '8px 16px' }}>
          Upload new version
        </Link>
      </div>

      <h2>Versions</h2>
      {versions.isLoading ? (
        <p>Loading versions…</p>
      ) : (versions.data ?? []).length === 0 ? (
        <p>No versions yet — upload the first one.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px' }}>#</th>
              <th style={{ padding: '8px 12px' }}>State</th>
              <th style={{ padding: '8px 12px' }}>Review</th>
              <th style={{ padding: '8px 12px' }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {(versions.data ?? []).map((v) => (
              <tr key={v.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '8px 12px' }}>
                  <Link href={`/versions/${v.id}`}>v{v.versionNo}</Link>
                </td>
                <td style={{ padding: '8px 12px' }}>{v.state}</td>
                <td style={{ padding: '8px 12px' }}>{v.reviewStatus}</td>
                <td style={{ padding: '8px 12px', color: '#666' }}>
                  {new Date(v.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: 16 }}>
        <Link href={`/campaigns/${c.campaignId}`}>Back to campaign</Link>
      </p>
    </>
  );
}
