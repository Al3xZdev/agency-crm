'use client';

import { useParams } from 'next/navigation';

import { LightboxView } from './LightboxView';

/**
 * Client version review (lightbox). Thin route wrapper — the whole client
 * portal preview lives in LightboxView, which talks to the client-scoped API
 * (GET /api/c/versions/:id, POST to /comments, POST to /decision) with the
 * same CLIENT session semantics as before.
 */
export default function ClientVersionReviewPage() {
  const params = useParams<{ id: string }>();
  const versionId = params.id;

  return <LightboxView versionId={versionId} />;
}
