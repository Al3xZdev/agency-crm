'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { apiFetch, apiJson } from '../../lib/api';
import { StatusPill } from '../../components/staff/StatusPill';

interface MeResponse {
  clientName: string;
}

interface CreativeRow {
  id: string;
  title: string;
  kind: 'IMAGE' | 'VIDEO' | 'TEXT';
  latestVersionId: string | null;
  latestVersionNo: number | null;
  reviewStatus: string | null;
  posterUrl: string | null;
}

type DecidedStatus = 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';

const REVIEW_STATUS: Record<string, boolean> = {
  APPROVED: true,
  REJECTED: true,
  CHANGES_REQUESTED: true,
};

function kindIcon(kind: CreativeRow['kind']): string {
  switch (kind) {
    case 'IMAGE':
      return 'ti-photo';
    case 'VIDEO':
      return 'ti-video';
    case 'TEXT':
      return 'ti-align-left';
  }
}

function kindLabel(kind: CreativeRow['kind']): string {
  switch (kind) {
    case 'IMAGE':
      return 'Imagen';
    case 'VIDEO':
      return 'Video';
    case 'TEXT':
      return 'Texto';
  }
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

  const items = creatives.data ?? [];

  // Pendiente = versión lista + reviewStatus NONE.
  const pending = items.filter(
    (c) => c.latestVersionId && c.reviewStatus === 'NONE',
  );

  // Historial = versión lista + decisión registrada.
  const history = items.filter(
    (c) =>
      c.latestVersionId &&
      c.reviewStatus != null &&
      REVIEW_STATUS[c.reviewStatus],
  );

  const clientName = me.data?.clientName ?? 'Cliente';

  return (
    <main className="client-shell">
      {/* Header */}
      <div className="client-topbar">
        <div className="brand">Agency Proofing</div>

        <div className="who">
          <span>{clientName}</span>
          <span aria-hidden="true">·</span>
          <span>Portal del cliente</span>
        </div>

        <button className="btn ghost" onClick={handleLogout} type="button">
          <i className="ti ti-logout" aria-hidden="true" />
          Salir
        </button>
      </div>

      <div className="client-body">
        {/* Intro */}
        <section className="client-intro">
          <div>
            <div className="client-eyebrow">Portal de revisión</div>

            <h1>
              Hola, {clientName}
              <span aria-hidden="true"> 👋</span>
            </h1>

            <p>
              Revisá los contenidos que tu equipo preparó y dejá tus
              comentarios directamente sobre cada creativo.
            </p>
          </div>

          {!creatives.isLoading && !creatives.isError && (
            <div className="client-summary">
              <span className="client-summary-value">{pending.length}</span>
              <span className="client-summary-label">
                {pending.length === 1
                  ? 'contenido pendiente'
                  : 'contenidos pendientes'}
              </span>
            </div>
          )}
        </section>

        {/* Pending reviews */}
        <section className="client-section">
          <div className="section-heading">
            <div>
              <div className="section-kicker">Requieren tu atención</div>
              <h2>Pendientes de tu revisión</h2>
            </div>

            {!creatives.isLoading &&
              !creatives.isError &&
              pending.length > 0 && (
                <span className="section-count">
                  {pending.length}
                </span>
              )}
          </div>

          {creatives.isLoading && (
            <div className="review-grid">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="review-card skeleton-row"
                  style={{ height: 360 }}
                />
              ))}
            </div>
          )}

          {creatives.isError && (
            <div className="error-banner">
              <div>
                <i className="ti ti-alert-circle" aria-hidden="true" />
                <span>
                  No pudimos cargar los creativos. Volvé a intentar.
                </span>
              </div>

              <button onClick={() => creatives.refetch()} type="button">
                Reintentar
              </button>
            </div>
          )}

          {!creatives.isLoading &&
            !creatives.isError &&
            pending.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon">
                  <i className="ti ti-circle-check" aria-hidden="true" />
                </div>

                <div>
                  <p>No tenés creativos pendientes de revisión.</p>
                  <span>
                    Cuando haya nuevo contenido para revisar, aparecerá acá.
                  </span>
                </div>
              </div>
            )}

          {!creatives.isLoading &&
            !creatives.isError &&
            pending.length > 0 && (
              <div className="review-grid">
                {pending.map((c) => (
                  <article key={c.id} className="review-card">
                    <div className="thumb">
                      {c.posterUrl ? (
                        <img
                          src={`/api/media/${c.posterUrl}`}
                          alt={c.title}
                          className="review-thumb"
                        />
                      ) : (
                        <div className="creative-placeholder">
                          <i
                            className={`ti ${kindIcon(c.kind)}`}
                            aria-hidden="true"
                          />
                        </div>
                      )}

                      <div className="thumb-overlay">
                        <span className="creative-type">
                          <i
                            className={`ti ${kindIcon(c.kind)}`}
                            aria-hidden="true"
                          />
                          {kindLabel(c.kind)}
                        </span>

                        <span className="play-indicator">
                          <i
                            className={
                              c.kind === 'VIDEO'
                                ? 'ti ti-player-play-filled'
                                : 'ti ti-arrow-up-right'
                            }
                            aria-hidden="true"
                          />
                        </span>
                      </div>
                    </div>

                    <div className="body">
                      <div className="campaign">
                        <span>Versión {c.latestVersionNo}</span>
                        <span aria-hidden="true">·</span>
                        <span>Pendiente</span>
                      </div>

                      <div className="name">{c.title}</div>

                      <Link
                        className="btn primary"
                        href={`/c/versions/${c.latestVersionId}`}
                      >
                        <span>Revisar contenido</span>
                        <i
                          className="ti ti-arrow-right"
                          aria-hidden="true"
                        />
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
        </section>

        {/* History */}
        {!creatives.isLoading &&
          !creatives.isError &&
          history.length > 0 && (
            <section className="client-section client-history">
              <div className="section-heading">
                <div>
                  <div className="section-kicker">Actividad</div>
                  <h2>Historial</h2>
                </div>
              </div>

              <div className="history-list">
                {history.map((c) => (
                  <button
                    key={c.id}
                    className="hist-row"
                    onClick={() =>
                      router.push(`/c/versions/${c.latestVersionId}`)
                    }
                    type="button"
                  >
                    <span className="history-main">
                      <span className="history-icon">
                        <i
                          className={`ti ${kindIcon(c.kind)}`}
                          aria-hidden="true"
                        />
                      </span>

                      <span className="history-content">
                        <span className="history-title">{c.title}</span>
                        <span className="history-meta">
                          Versión {c.latestVersionNo}
                        </span>
                      </span>
                    </span>

                    <span className="history-action">
                      {c.reviewStatus ? (
                        <StatusPill
                          status={c.reviewStatus as DecidedStatus}
                        />
                      ) : null}

                      <i
                        className="ti ti-chevron-right"
                        aria-hidden="true"
                      />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
      </div>
    </main>
  );
}