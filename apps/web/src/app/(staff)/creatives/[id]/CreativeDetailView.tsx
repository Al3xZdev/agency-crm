'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../../../lib/api';
import {
  Creative,
  CreativeKind,
  CreativeStatus,
  CreativeVersionSummary,
  ReviewDecision,
  ReviewStatus,
} from '../../../../lib/types';
import { StatusPill } from '../../../../components/staff/StatusPill';
import { CommentThread } from '../../../../components/staff/CommentThread';

const DECISION_OPTIONS: { value: ReviewDecision; label: string; icon: string }[] = [
  { value: 'APPROVED', label: 'Aprobar', icon: 'check' },
  { value: 'REQUEST_CHANGES', label: 'Solicitar cambios', icon: 'repeat' },
  { value: 'REJECTED', label: 'Rechazar', icon: 'x' },
];

/**
 * Creative detail (PR4). Data:
 *  - GET /api/creatives/:id — creative header (title/kind/status).
 *  - GET /api/creatives/:id/versions — version filmstrip (separate endpoint).
 *  - GET/POST /api/versions/:versionId/comments via CommentThread.
 *  - POST /api/versions/:versionId/decision `{ decision }` to cast a review.
 * The creative header has no clientName, so the breadcrumb links back to the
 * owning campaign.
 */
export function CreativeDetailView({ creativeId }: { creativeId: string }) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: creative, isLoading, isError, refetch } = useQuery({
    queryKey: ['creative', creativeId],
    queryFn: () => apiFetch<Creative>(`/api/creatives/${creativeId}`),
  });

  const {
    data: versions,
    isLoading: loadingVersions,
    isError: versionsError,
  } = useQuery({
    queryKey: ['versions', creativeId],
    queryFn: () => apiFetch<CreativeVersionSummary[]>(`/api/creatives/${creativeId}/versions`),
    enabled: !!creativeId,
  });

  const castDecision = useMutation({
    mutationFn: (decision: ReviewDecision) =>
      apiFetch<{ id: string; decision: ReviewDecision }>(`/api/versions/${selectedVersionId}/decision`, {
        method: 'POST',
        body: { decision },
      }),
    onSuccess: () => {
      setDecisionError(null);
      queryClient.invalidateQueries({ queryKey: ['versions', creativeId] });
      queryClient.invalidateQueries({ queryKey: ['creative', creativeId] });
    },
    onError: (err) => {
      setDecisionError(err instanceof ApiError ? err.message : 'No pudimos guardar la decisión.');
    },
  });

  // Select the latest version (first, since the backend orders versionNo desc).
  useEffect(() => {
    if (versions && !selectedVersionId) {
      setSelectedVersionId(versions[0]?.id ?? null);
    }
  }, [versions, selectedVersionId]);

  if (isError) {
    return (
      <div className="error-banner">
        <span>No pudimos cargar este creativo.</span>
        <button onClick={() => refetch()}>Reintentar</button>
      </div>
    );
  }

  if (isLoading || !creative) {
    return (
      <div className="detail-grid">
        <div className="filmstrip skeleton-row" />
        <div className="stage skeleton-row" />
        <div className="comment-panel skeleton-row" />
      </div>
    );
  }

  const selectedVersion = versions?.find((v) => v.id === selectedVersionId) ?? versions?.[0];

  return (
    <div>
      <div className="staff-topbar" style={{ marginBottom: 14 }}>
        <div className="breadcrumb" style={{ marginBottom: 0 }}>
          <button className="link-btn" onClick={() => router.push(`/campaigns/${creative.campaignId}`)}>
            Campaña
          </button>
          {' / '}
          {creative.title}
        </div>
        <button className="btn primary" onClick={() => router.push(`/upload/${creative.id}`)}>
          <i className="ti ti-upload" aria-hidden="true" />
          Subir nueva versión
        </button>
      </div>

      <div className="detail-grid">
        <div className="filmstrip">
          {loadingVersions &&
            Array.from({ length: 3 }).map((_, i) => <div key={i} className="vthumb skeleton-row" />)}
          {versionsError && <span className="mono">No pudimos cargar las versiones.</span>}
          {(versions ?? []).map((version) => (
            <button
              key={version.id}
              className={version.id === selectedVersion?.id ? 'vthumb active' : 'vthumb'}
              onClick={() => setSelectedVersionId(version.id)}
            >
              <div className="box" />
              <div className="mono">v{version.versionNo}</div>
            </button>
          ))}
        </div>

        <div className="stage">
          {selectedVersion ? (
            <>
              <MediaPreview kind={creative.kind} version={selectedVersion} />

              {selectedVersion.reviewStatus !== 'NONE' ? (
                <div className="decision-banner">
                  <StatusPill status={reviewStatusAsCreative(selectedVersion.reviewStatus)} />
                  <span>
                    Decisión registrada sobre la v{selectedVersion.versionNo}
                  </span>
                </div>
              ) : selectedVersion.state === 'READY' ? (
                <div className="decision-banner" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                  <span>¿Cuál es tu decisión sobre esta versión?</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {DECISION_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        className={option.value === 'REJECTED' ? 'btn red' : option.value === 'REQUEST_CHANGES' ? 'btn' : 'btn green'}
                        disabled={castDecision.isPending}
                        onClick={() => castDecision.mutate(option.value)}
                      >
                        <i className={`ti ti-${option.icon}`} aria-hidden="true" />
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="decision-banner">
                  <span>
                    {selectedVersion.state === 'PROCESSING' ? 'Procesando versión…' : 'Esta versión no puede revisarse todavía.'}
                  </span>
                </div>
              )}

              {decisionError && (
                <div className="error-banner" style={{ marginTop: 12 }}>
                  <span>{decisionError}</span>
                </div>
              )}
            </>
          ) : (
            <div className="media-box">
              <i className="ti ti-photo-off" aria-hidden="true" />
            </div>
          )}
        </div>

        {selectedVersion && <CommentThread versionId={selectedVersion.id} />}
      </div>
    </div>
  );
}

function MediaPreview({
  kind,
  version,
}: {
  kind: CreativeKind;
  version: CreativeVersionSummary;
}) {
  if (kind === 'TEXT') {
    return (
      <div className="media-box text-preview">
        <p>{version.textBody ?? 'Sin contenido de texto.'}</p>
      </div>
    );
  }
  if (kind === 'VIDEO') {
    return (
      <div className="media-box">
        <i className="ti ti-player-play" aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className="media-box">
      <i className="ti ti-photo" aria-hidden="true" />
    </div>
  );
}

/** ReviewStatus (NONE/APPROVED/REJECTED/CHANGES_REQUESTED) → CreativeStatus for the pill. */
function reviewStatusAsCreative(status: Exclude<ReviewStatus, 'NONE'>): CreativeStatus {
  return status as CreativeStatus;
}
