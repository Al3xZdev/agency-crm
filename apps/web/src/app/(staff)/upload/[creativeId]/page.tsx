'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { apiFetch, apiJson, ApiError } from '../../../../lib/api';

interface CreativeDetail {
  id: string;
  title: string;
  kind: 'IMAGE' | 'VIDEO' | 'TEXT';
  status: string;
}

interface CreatedVersion {
  id: string;
  versionNo: number;
  state: string;
}

const MAX_UPLOAD_MB = 500;

/**
 * Version uploader (task 5b.7). Binary kinds stream a multipart form; TEXT
 * creatives paste content that becomes READY immediately. The declared-size
 * cap is enforced by the API's admission gate; a 413 renders a message that
 * names the cap.
 */
export default function UploadVersionPage() {
  const params = useParams<{ creativeId: string }>();
  const creativeId = params.creativeId;
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [textBody, setTextBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const creative = useQuery({
    queryKey: ['creative', creativeId],
    queryFn: () => apiJson<CreativeDetail>(`/api/creatives/${creativeId}`),
  });

  function describeFailure(status: number, message: string): string {
    if (status === 413) return `That file exceeds the ${MAX_UPLOAD_MB} MB limit.`;
    if (status === 415) return 'That file type is not supported.';
    return message || `Upload failed (${status}).`;
  }

  async function postJson<T>(path: string, body: unknown): Promise<T> {
    // apiFetch now parses JSON + throws ApiError; remap the status-specific
    // copy (413 cap / 415 type) that this page bakes into its messages.
    try {
      return await apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });
    } catch (err) {
      if (err instanceof ApiError) {
        throw Object.assign(new Error(describeFailure(err.status, err.message)), { status: err.status });
      }
      throw err;
    }
  }

  async function postMultipart<T>(path: string, file: File): Promise<T> {
    // No explicit Content-Type: the browser must set the multipart boundary.
    const form = new FormData();
    form.append('file', file);
    try {
      return await apiFetch<T>(path, { method: 'POST', body: form });
    } catch (err) {
      if (err instanceof ApiError) {
        throw Object.assign(new Error(describeFailure(err.status, err.message)), { status: err.status });
      }
      throw err;
    }
  }

  const uploadFile = useMutation({
    mutationFn: (file: File) =>
      postMultipart<CreatedVersion>(`/api/creatives/${creativeId}/versions`, file),
    onSuccess: (v) => {
      setError(null);
      setDone(`Version ${v.versionNo} uploaded — processing started.`);
      if (fileInput.current) fileInput.current.value = '';
      void queryClient.invalidateQueries({ queryKey: ['creative', creativeId] });
    },
    onError: (err: Error) => {
      setDone(null);
      setError(err.message);
    },
  });

  const pasteText = useMutation({
    mutationFn: () =>
      postJson<CreatedVersion>(`/api/creatives/${creativeId}/versions/text`, { textBody }),
    onSuccess: (v) => {
      setError(null);
      setTextBody('');
      setDone(`Version ${v.versionNo} saved — ready for review.`);
      void queryClient.invalidateQueries({ queryKey: ['creative', creativeId] });
    },
    onError: (err: Error) => {
      setDone(null);
      setError(err.message);
    },
  });

  function onUpload(e: FormEvent) {
    e.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (file) uploadFile.mutate(file);
  }

  function onPaste(e: FormEvent) {
    e.preventDefault();
    if (textBody.trim()) pasteText.mutate();
  }

  if (creative.isLoading) return <p>Loading…</p>;
  if (creative.isError) {
    return (
      <p role="alert">
        Creative not found. <Link href="/clients">Back to clients</Link>
      </p>
    );
  }
  const c = creative.data!;
  const busy = uploadFile.isPending || pasteText.isPending;

  return (
    <>
      <h1>Upload version</h1>
      <p style={{ color: '#666' }}>
        {c.title} · {c.kind} · current status: <strong>{c.status}</strong>
      </p>

      {error && (
        <p role="alert" style={{ color: '#b00020' }}>
          {error}
        </p>
      )}
      {done && (
        <p role="status" style={{ color: '#0a7d33' }}>
          {done}
        </p>
      )}

      {c.kind === 'TEXT' ? (
        <form onSubmit={onPaste}>
          <textarea
            rows={10}
            required
            placeholder="Paste the ad text…"
            value={textBody}
            onChange={(e) => setTextBody(e.target.value)}
            style={{ width: '100%', maxWidth: 640, padding: 8 }}
          />
          <div>
            <button type="submit" disabled={busy} style={{ padding: '8px 16px' }}>
              Save text version
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={onUpload}>
          {/* Cap shown next to the control so it is visible BEFORE picking. */}
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,.txt,.md" required />
          <p style={{ color: '#666' }}>Maximum file size: {MAX_UPLOAD_MB} MB.</p>
          <button type="submit" disabled={busy} style={{ padding: '8px 16px' }}>
            Upload version
          </button>
        </form>
      )}

      <p>
        <Link href="/clients">Back to clients</Link>
      </p>
    </>
  );
}
