'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { apiJson } from '../../../../lib/api';

interface VersionDetail {
  id: string;
  creativeId: string;
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
  commentsCount: number;
  reviewEvent: { id: string; decision: string; actorType: string; actorLabel: string; occurredAt: string } | null;
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

const ANCHOR_TYPES = ['PLAIN', 'PIN', 'RANGE'] as const;

function DescribeAnchor(c: CommentRow): string {
  if (c.anchor === 'PIN' && c.posX != null && c.posY != null) return ` @ (${c.posX}, ${c.posY})`;
  if (c.anchor === 'RANGE' && c.startMs != null && c.endMs != null) return ` [${c.startMs}ms – ${c.endMs}ms]`;
  return '';
}

export default function VersionReviewPage() {
  const params = useParams<{ id: string }>();
  const versionId = params.id;
  const queryClient = useQueryClient();

  const [anchor, setAnchor] = useState<(typeof ANCHOR_TYPES)[number]>('PLAIN');
  const [posX, setPosX] = useState('');
  const [posY, setPosY] = useState('');
  const [startMs, setStartMs] = useState('');
  const [endMs, setEndMs] = useState('');
  const [body, setBody] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);

  const version = useQuery({
    queryKey: ['version', versionId],
    queryFn: () => apiJson<VersionDetail>(`/api/versions/${versionId}`),
  });

  const comments = useQuery({
    queryKey: ['comments', versionId],
    queryFn: () => apiJson<CommentRow[]>(`/api/versions/${versionId}/comments`),
    enabled: !!versionId,
  });

  const addComment = useMutation({
    mutationFn: (payload: {
      anchor: string;
      body: string;
      posX?: number;
      posY?: number;
      startMs?: number;
      endMs?: number;
    }) =>
      apiJson<CommentRow>(`/api/versions/${versionId}/comments`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setCommentError(null);
      setBody('');
      setAnchor('PLAIN');
      setPosX('');
      setPosY('');
      setStartMs('');
      setEndMs('');
      void queryClient.invalidateQueries({ queryKey: ['comments', versionId] });
      void queryClient.invalidateQueries({ queryKey: ['version', versionId] });
    },
    onError: (err: Error) => setCommentError(err.message),
  });

  const castDecision = useMutation({
    mutationFn: (decision: string) =>
      apiJson<{ id: string; decision: string }>(`/api/versions/${versionId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['version', versionId] });
    },
  });

  function onComment(e: FormEvent) {
    e.preventDefault();
    const payload: {
      anchor: string;
      body: string;
      posX?: number;
      posY?: number;
      startMs?: number;
      endMs?: number;
    } = { anchor, body };

    if (anchor === 'PIN') {
      payload.posX = Number(posX);
      payload.posY = Number(posY);
    }
    if (anchor === 'RANGE') {
      payload.startMs = Number(startMs);
      payload.endMs = Number(endMs);
    }

    addComment.mutate(payload);
  }

  if (version.isLoading) return <p>Loading…</p>;
  if (version.isError) {
    return (
      <p role="alert">
        Version not found. <Link href="/clients">Back to clients</Link>
      </p>
    );
  }

  const v = version.data!;
  const decisionBusy = castDecision.isPending;
  const existingDecision = v.reviewEvent;
  const hasDecision = existingDecision != null;

  return (
    <>
      <h1>Version {v.versionNo}</h1>
      <p style={{ color: '#666' }}>
        State: <strong>{v.state}</strong> · Review: <strong>{v.reviewStatus}</strong> ·{' '}
        {new Date(v.createdAt).toLocaleDateString()}
      </p>

      <section style={{ margin: '16px 0' }}>
        <h2>Preview</h2>
        {v.state !== 'READY' && v.state !== 'FAILED' && (
          <p style={{ color: '#666' }}>Processing{v.failReason ? `: ${v.failReason}` : '…'}</p>
        )}
        {v.state === 'READY' && v.asset && v.asset.mime.startsWith('image') && (
          <img
            src={v.posterUrl || v.asset.storageKey}
            alt={`Version ${v.versionNo}`}
            style={{ maxWidth: '100%', maxHeight: 500 }}
          />
        )}
        {v.state === 'READY' && v.asset && v.asset.mime.startsWith('video') && (
          <video
            src={v.asset.storageKey}
            poster={v.posterUrl || undefined}
            controls
            style={{ maxWidth: '100%', maxHeight: 500 }}
          />
        )}
        {v.state === 'READY' && v.textBody && (
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              padding: 12,
              background: '#f9f9f9',
              border: '1px solid #eee',
              borderRadius: 4,
            }}
          >
            {v.textBody}
          </pre>
        )}
      </section>

      <section style={{ margin: '16px 0' }}>
        <h2>Comments ({v.commentsCount})</h2>
        {(comments.data ?? []).length === 0 && <p>No comments yet.</p>}
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {(comments.data ?? []).map((c) => (
            <li key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
              <strong>{c.authorLabel}</strong> ({c.authorType})
              {DescribeAnchor(c)}
              <span style={{ color: '#999', marginLeft: 8 }}>
                {new Date(c.createdAt).toLocaleString()}
              </span>
              <p style={{ margin: '4px 0 0' }}>{c.body}</p>
            </li>
          ))}
        </ul>

        <form onSubmit={onComment} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 500, marginTop: 12 }}>
          <textarea
            rows={3}
            required
            placeholder="Add a comment…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            style={{ padding: 8 }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={anchor} onChange={(e) => setAnchor(e.target.value as (typeof ANCHOR_TYPES)[number])} style={{ padding: 8 }}>
              {ANCHOR_TYPES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            {anchor === 'PIN' && (
              <>
                <input
                  type="number"
                  placeholder="posX"
                  required
                  value={posX}
                  onChange={(e) => setPosX(e.target.value)}
                  style={{ width: 80, padding: 8 }}
                />
                <input
                  type="number"
                  placeholder="posY"
                  required
                  value={posY}
                  onChange={(e) => setPosY(e.target.value)}
                  style={{ width: 80, padding: 8 }}
                />
              </>
            )}
            {anchor === 'RANGE' && (
              <>
                <input
                  type="number"
                  placeholder="startMs"
                  required
                  value={startMs}
                  onChange={(e) => setStartMs(e.target.value)}
                  style={{ width: 100, padding: 8 }}
                />
                <input
                  type="number"
                  placeholder="endMs"
                  required
                  value={endMs}
                  onChange={(e) => setEndMs(e.target.value)}
                  style={{ width: 100, padding: 8 }}
                />
              </>
            )}
          </div>
          {commentError && (
            <p role="alert" style={{ color: '#b00020' }}>
              {commentError}
            </p>
          )}
          <button type="submit" disabled={addComment.isPending} style={{ padding: '8px 16px', alignSelf: 'flex-start' }}>
            Post comment
          </button>
        </form>
      </section>

      <section style={{ margin: '16px 0' }}>
        <h2>Decision</h2>
        {hasDecision ? (
          <p>
            Decision already cast: <strong>{existingDecision.decision}</strong> by {existingDecision.actorLabel} (
            {new Date(existingDecision.occurredAt).toLocaleString()})
          </p>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              disabled={decisionBusy}
              onClick={() => castDecision.mutate('APPROVED')}
              style={{ padding: '8px 16px', background: '#0a7d33', color: '#fff', border: 'none', borderRadius: 4 }}
            >
              Approve
            </button>
            <button
              disabled={decisionBusy}
              onClick={() => castDecision.mutate('REJECTED')}
              style={{ padding: '8px 16px', background: '#b00020', color: '#fff', border: 'none', borderRadius: 4 }}
            >
              Reject
            </button>
            <button
              disabled={decisionBusy}
              onClick={() => castDecision.mutate('REQUEST_CHANGES')}
              style={{ padding: '8px 16px', background: '#c77700', color: '#fff', border: 'none', borderRadius: 4 }}
            >
              Request Changes
            </button>
          </div>
        )}
      </section>

      <p style={{ marginTop: 16 }}>
        <Link href={`/creatives/${v.creativeId}`}>Back to creative</Link>
      </p>
    </>
  );
}
