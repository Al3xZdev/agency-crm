'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { apiJson } from '../../../../lib/api';

interface VersionDetail {
  id: string;
  creativeId: string;
  creativeTitle: string;
  versionNo: number;
  state: string;
  reviewStatus: string;
  textBody: string | null;
  failReason: string | null;
  durationMs: number | null;
  createdAt: string;
  asset: { sha256: string; mime: string; byteSize: number; storageKey: string } | null;
  poster: { sha256: string; mime: string; byteSize: number; storageKey: string } | null;
  posterUrl: string | null;
  comments: CommentRow[];
  commentsCount: number;
  reviewEvent: ReviewEvent | null;
}

interface CommentRow {
  id: string;
  anchor: string;
  posX: number | null;
  posY: number | null;
  startMs: number | null;
  endMs: number | null;
  body: string;
  authorType: string;
  authorLabel: string;
  createdAt: string;
}

interface ReviewEvent {
  id: string;
  decision: string;
  actorType: string;
  actorLabel: string;
  occurredAt: string;
}

function formatDecision(d: string): string {
  switch (d) {
    case 'APPROVED':
      return 'Approved';
    case 'REJECTED':
      return 'Rejected';
    case 'REQUEST_CHANGES':
      return 'Changes Requested';
    default:
      return d;
  }
}

function decisionBadge(d: string): string {
  switch (d) {
    case 'APPROVED':
      return 'bg-green-100 text-green-800';
    case 'REJECTED':
      return 'bg-red-100 text-red-800';
    case 'REQUEST_CHANGES':
      return 'bg-orange-100 text-orange-800';
    default:
      return 'bg-neutral-100 text-neutral-700';
  }
}

function describeAnchor(c: CommentRow): string {
  if (c.anchor === 'PIN' && c.posX != null && c.posY != null) return ` @ (${c.posX}, ${c.posY})`;
  if (c.anchor === 'RANGE' && c.startMs != null && c.endMs != null) return ` [${c.startMs}ms \u2013 ${c.endMs}ms]`;
  return '';
}

export default function ClientVersionReviewPage() {
  const params = useParams<{ id: string }>();
  const versionId = params.id;
  const queryClient = useQueryClient();

  const [commentBody, setCommentBody] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);

  const version = useQuery({
    queryKey: ['c-version', versionId],
    queryFn: () => apiJson<VersionDetail>(`/api/c/versions/${versionId}`),
    enabled: !!versionId,
  });

  const addComment = useMutation({
    mutationFn: (payload: { body: string }) =>
      apiJson<CommentRow>(`/api/c/versions/${versionId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ ...payload, anchor: 'PLAIN' }),
      }),
    onSuccess: () => {
      setCommentError(null);
      setCommentBody('');
      void queryClient.invalidateQueries({ queryKey: ['c-version', versionId] });
    },
    onError: (err: Error) => setCommentError(err.message),
  });

  const castDecision = useMutation({
    mutationFn: (decision: string) =>
      apiJson<{ id: string; decision: string }>(`/api/c/versions/${versionId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['c-version', versionId] });
    },
  });

  function onComment(e: FormEvent) {
    e.preventDefault();
    addComment.mutate({ body: commentBody });
  }

  if (version.isLoading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="h-6 w-48 animate-pulse rounded bg-neutral-200" />
        <div className="mt-4 h-64 animate-pulse rounded-lg bg-neutral-200" />
      </main>
    );
  }

  if (version.isError) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p className="text-sm text-red-600" role="alert">
          Version not found.
        </p>
        <Link href="/c" className="mt-4 inline-block text-sm text-blue-600 hover:underline">
          Back to dashboard
        </Link>
      </main>
    );
  }

  const v = version.data!;
  const hasDecision = v.reviewEvent != null;
  const decisionBusy = castDecision.isPending;
  const mediaUrl = v.asset ? `/api/media/${v.asset.storageKey}` : null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/c" className="mb-6 inline-block text-sm text-neutral-500 hover:text-neutral-800">
        &larr; Dashboard
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">{v.creativeTitle}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Version {v.versionNo} &middot; {new Date(v.createdAt).toLocaleDateString()}
          </p>
        </div>
        <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700">
          {v.reviewStatus.replace(/_/g, ' ')}
        </span>
      </div>

      {/* Media preview */}
      {v.state === 'READY' && v.asset && v.asset.mime.startsWith('image') && (
        <div className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <img
            src={v.posterUrl || mediaUrl || undefined}
            alt={`${v.creativeTitle} v${v.versionNo}`}
            className="w-full object-contain"
            style={{ maxHeight: 500 }}
          />
        </div>
      )}

      {v.state === 'READY' && v.asset && v.asset.mime.startsWith('video') && (
        <div className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <video
            src={mediaUrl || undefined}
            poster={v.posterUrl || undefined}
            controls
            className="w-full"
            style={{ maxHeight: 500 }}
          />
        </div>
      )}

      {v.state === 'READY' && v.textBody && (
        <div className="mt-6 whitespace-pre-wrap rounded-lg border border-neutral-200 bg-white p-5 text-sm text-neutral-800">
          {v.textBody}
        </div>
      )}

      {v.state === 'FAILED' && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Generation failed{v.failReason ? `: ${v.failReason}` : ''}
        </div>
      )}

      {/* Comments */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-900">
          Comments ({v.commentsCount})
        </h2>

        {v.comments.length === 0 && (
          <p className="mt-3 text-sm text-neutral-500">No comments yet.</p>
        )}

        <ul className="mt-3 divide-y divide-neutral-100">
          {v.comments.map((c) => (
            <li key={c.id} className="py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-neutral-900">{c.authorLabel}</span>
                <span className="text-xs text-neutral-400">{c.authorType}</span>
                <span className="text-xs text-neutral-400">{describeAnchor(c)}</span>
                <span className="ml-auto text-xs text-neutral-400">
                  {new Date(c.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="mt-1 text-sm text-neutral-700">{c.body}</p>
            </li>
          ))}
        </ul>

        <form onSubmit={onComment} className="mt-4 flex gap-2">
          <textarea
            rows={2}
            required
            placeholder="Add a comment\u2026"
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={addComment.isPending}
            className="self-end rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {addComment.isPending ? 'Posting\u2026' : 'Post'}
          </button>
        </form>

        {commentError && (
          <p className="mt-2 text-sm text-red-600" role="alert">
            {commentError}
          </p>
        )}
      </section>

      {/* Decision */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-neutral-900">Decision</h2>

        {hasDecision ? (
          <div className="mt-3 flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${decisionBadge(v.reviewEvent!.decision)}`}>
              {formatDecision(v.reviewEvent!.decision)}
            </span>
            <span className="text-xs text-neutral-400">
              by {v.reviewEvent!.actorLabel} &middot;{' '}
              {new Date(v.reviewEvent!.occurredAt).toLocaleString()}
            </span>
          </div>
        ) : (
          <div className="mt-3 flex gap-3">
            <button
              disabled={decisionBusy}
              onClick={() => castDecision.mutate('APPROVED')}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {decisionBusy ? 'Saving\u2026' : 'Approve \u2713'}
            </button>
            <button
              disabled={decisionBusy}
              onClick={() => castDecision.mutate('REJECTED')}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {decisionBusy ? 'Saving\u2026' : 'Reject \u2715'}
            </button>
            <button
              disabled={decisionBusy}
              onClick={() => castDecision.mutate('REQUEST_CHANGES')}
              className="rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
            >
              {decisionBusy ? 'Saving\u2026' : 'Request Changes \u21BA'}
            </button>
          </div>
        )}

        {castDecision.isError && (
          <p className="mt-2 text-sm text-red-600" role="alert">
            {castDecision.error.message}
          </p>
        )}
      </section>
    </main>
  );
}
