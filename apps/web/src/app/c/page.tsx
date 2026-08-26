'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { apiFetch, apiJson } from '../../lib/api';

interface MeResponse {
  clientName: string;
}

interface CreativeRow {
  id: string;
  title: string;
  kind: 'IMAGE' | 'VIDEO' | 'TEXT';
  latestVersionId: string;
  latestVersionNo: number;
  reviewStatus: string;
}

function kindIcon(kind: CreativeRow['kind']): string {
  switch (kind) {
    case 'IMAGE':
      return '\u{1F5BC}';
    case 'VIDEO':
      return '\u{1F3AC}';
    case 'TEXT':
      return '\u{1F4DD}';
  }
}

function statusBadge(status: string): string {
  switch (status) {
    case 'PENDING_REVIEW':
      return 'bg-amber-100 text-amber-800';
    case 'APPROVED':
      return 'bg-green-100 text-green-800';
    case 'REJECTED':
      return 'bg-red-100 text-red-800';
    case 'CHANGES_REQUESTED':
      return 'bg-orange-100 text-orange-800';
    default:
      return 'bg-neutral-100 text-neutral-700';
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export default function ClientDashboard() {
  const router = useRouter();

  const me = useQuery({
    queryKey: ['c-me'],
    queryFn: () => apiJson<MeResponse>('/api/c/me'),
  });

  const creatives = useQuery({
    queryKey: ['c-creatives'],
    queryFn: () => apiJson<CreativeRow[]>('/api/c/creatives'),
  });

  async function handleLogout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    router.replace('/c/invalid');
  }

  const clientName = me.data?.clientName ?? 'there';
  const items = creatives.data ?? [];

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-neutral-900">Welcome, {clientName}</h1>
        <button
          onClick={handleLogout}
          className="text-sm text-neutral-500 hover:text-neutral-800"
        >
          Sign out
        </button>
      </div>

      {creatives.isLoading && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-40 animate-pulse rounded-lg border border-neutral-200 bg-white" />
          ))}
        </div>
      )}

      {creatives.isError && (
        <p className="mt-8 text-sm text-red-600" role="alert">
          Failed to load creatives. Please try again.
        </p>
      )}

      {!creatives.isLoading && !creatives.isError && items.length === 0 && (
        <p className="mt-8 text-sm text-neutral-500">No creatives pending review.</p>
      )}

      {!creatives.isLoading && items.length > 0 && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {items.map((c) => (
            <Link
              key={c.id}
              href={`/c/versions/${c.latestVersionId}`}
              className="block rounded-lg border border-neutral-200 bg-white p-5 transition hover:border-neutral-300 hover:shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span>{kindIcon(c.kind)}</span>
                <h2 className="font-medium text-neutral-900">{c.title}</h2>
              </div>
              <p className="mt-1 text-sm text-neutral-500">
                Version {c.latestVersionNo}
              </p>
              <span
                className={`mt-3 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge(c.reviewStatus)}`}
              >
                {statusLabel(c.reviewStatus)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
