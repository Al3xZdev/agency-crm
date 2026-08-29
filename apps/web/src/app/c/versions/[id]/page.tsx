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

function decisionPill(d: string): { label: string; className: string } {
  switch (d) {
    case 'APPROVED':
      return { label: 'approved', className: 'pill approved' };
    case 'REJECTED':
      return { label: 'rejected', className: 'pill rejected' };
    case 'REQUEST_CHANGES':
      return { label: 'changes requested', className: 'pill pending' };
    default:
      return { label: d.replace(/_/g, ' '), className: 'pill processing' };
  }
}

function describeAnchor(c: CommentRow): string {
  if (c.anchor === 'PIN' && c.posX != null && c.posY != null) return ` @ (${c.posX}, ${c.posY})`;
  if (c.anchor === 'RANGE' && c.startMs != null && c.endMs != null) return ` [${c.startMs}ms \u2013 ${c.endMs}ms]`;
  return '';
}

/**
 * Client version review (PR5 restyle). Keeps the EXACT client-scoped API
 * calls — GET /api/c/versions/:id, POST /api/c/versions/:id/comments,
 * POST /api/c/versions/:id/decision — and the CLIENT session semantics.
 * The comment form posts to the client route (NOT the staff CommentThread
 * route); only the styling changes.
 */
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
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 28px' }}>
        <div className="skeleton-row" style={{ height: 26, borderRadius: 6 }} />
        <div className="skeleton-row" style={{ height: 320, borderRadius: 6, marginTop: 20 }} />
      </main>
    );
  }

  if (version.isError) {
    return (
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 28px' }}>
        <div className="empty-state">
          <i className="ti ti-photo-off" aria-hidden="true" />
          <p>Version not found.</p>
          <Link href="/c" className="btn ghost" style={{ textDecoration: 'none' }}>
            &larr; Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  const v = version.data!;
  const hasDecision = v.reviewEvent != null;
  const decisionBusy = castDecision.isPending;
  const mediaUrl = v.asset ? `/api/media/${v.asset.storageKey}` : null;
  const statusPill = decisionPill(hasDecision && v.reviewEvent ? v.reviewEvent.decision : v.reviewStatus);

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 28px' }}>
      <Link href="/c" className="link-btn" style={{ display: 'inline-block', marginBottom: 18 }}>
        &larr; Dashboard
      </Link>

      <div className="client-header" style={{ marginBottom: 22 }}>
        <div className="client-id">
          <div className="avatar">{'V'}</div>
          <div>
            <h1 style={{ fontSize: 18 }}>{v.creativeTitle}</h1>
            <p className="eyebrow" style={{ margin: '4px 0 0' }}>
              Version {v.versionNo} &middot; {new Date(v.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
        <span className={statusPill.className}>{statusPill.label}</span>
      </div>

      {/* Media preview */}
      {v.state === 'READY' && v.asset && v.asset.mime.startsWith('image') && (
        <div className="settings-card" style={{ maxWidth: '100%', overflow: 'hidden', padding: 0 }}>
          <img
            src={v.posterUrl || mediaUrl || undefined}
            alt={`${v.creativeTitle} v${v.versionNo}`}
            style={{ width: '100%', objectFit: 'contain', maxHeight: 500, display: 'block' }}
          />
        </div>
      )}

      {v.state === 'READY' && v.asset && v.asset.mime.startsWith('video') && (
        <div className="settings-card" style={{ maxWidth: '100%', overflow: 'hidden', padding: 0 }}>
          <video
            src={mediaUrl || undefined}
            poster={v.posterUrl || undefined}
            controls
            style={{ width: '100%', maxHeight: 500, display: 'block' }}
          />
        </div>
      )}

      {v.state === 'READY' && v.textBody && (
        <div className="settings-card" style={{ maxWidth: '100%', whiteSpace: 'pre-wrap' }}>
          {v.textBody}
        </div>
      )}

      {v.state === 'FAILED' && (
        <div className="error-banner" style={{ marginTop: 20 }}>
          <span>
            Generation failed{v.failReason ? `: ${v.failReason}` : ''}
          </span>
        </div>
      )}

      {/* Comments */}
      <section className="settings-card" style={{ maxWidth: '100%', marginTop: 24 }}>
        <h3 style={{ fontSize: 15 }}>
          Comments ({v.commentsCount})
        </h3>

        {v.comments.length === 0 && (
          <p className="eyebrow" style={{ marginTop: 12 }}>
            No comments yet.
          </p>
        )}

        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
          {v.comments.map((c) => (
            <li key={c.id} className="comment" style={{ borderBottom: '1px solid var(--paper-line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="who">{c.authorLabel}</span>
                <span className="when">{c.authorType}</span>
                <span className="when">{describeAnchor(c)}</span>
                <span className="when" style={{ marginLeft: 'auto' }}>
                  {new Date(c.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="txt" style={{ margin: '6px 0 0' }}>{c.body}</p>
            </li>
          ))}
        </ul>

        <form onSubmit={onComment} style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <textarea
            rows={2}
            required
            placeholder="Add a comment\u2026"
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            style={{
              flex: 1,
              border: '1px solid var(--paper-line)',
              borderRadius: 'var(--radius)',
              padding: '8px 10px',
              fontSize: 13,
              background: '#fff',
              fontFamily: 'var(--sans)',
              resize: 'vertical',
            }}
          />
          <button type="submit" className="btn primary" disabled={addComment.isPending} style={{ alignSelf: 'flex-end' }}>
            {addComment.isPending ? 'Posting\u2026' : 'Post'}
          </button>
        </form>

        {commentError && (
          <p className="field-error" style={{ marginTop: 10 }}>
            {commentError}
          </p>
        )}
      </section>

      {/* Decision */}
      <section className="settings-card" style={{ maxWidth: '100%', marginTop: 24 }}>
        <h3 style={{ fontSize: 15 }}>Decision</h3>

        {hasDecision && v.reviewEvent ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <span className={decisionPill(v.reviewEvent.decision).className}>
              {formatDecision(v.reviewEvent.decision)}
            </span>
            <span className="eyebrow">
              by {v.reviewEvent.actorLabel} &middot; {new Date(v.reviewEvent.occurredAt).toLocaleString()}
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button
              disabled={decisionBusy}
              onClick={() => castDecision.mutate('APPROVED')}
              className="btn green"
            >
              {decisionBusy ? 'Saving\u2026' : 'Approve \u2713'}
            </button>
            <button
              disabled={decisionBusy}
              onClick={() => castDecision.mutate('REJECTED')}
              className="btn red"
            >
              {decisionBusy ? 'Saving\u2026' : 'Reject \u2715'}
            </button>
            <button
              disabled={decisionBusy}
              onClick={() => castDecision.mutate('REQUEST_CHANGES')}
              className="btn"
              style={{ background: 'var(--amber-bg)', borderColor: 'var(--amber)', color: 'var(--amber)' }}
            >
              {decisionBusy ? 'Saving\u2026' : 'Request Changes \u21BA'}
            </button>
          </div>
        )}

        {castDecision.isError && (
          <p className="field-error" style={{ marginTop: 12 }}>
            {castDecision.error.message}
          </p>
        )}
      </section>
    </main>
  );
}
