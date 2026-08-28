'use client';

import { DragEvent, FormEvent, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError, uploadWithProgress } from '../../../../lib/api';
import { Creative } from '../../../../lib/types';

type Status = 'IDLE' | 'UPLOADING' | 'DONE' | 'ERROR';

const MAX_SIZE_MB = 500;

/**
 * Version upload (PR4). The backend contract differs from the reference:
 *  - Binary kinds: POST /api/creatives/:id/versions (multipart, field `file`).
 *  - TEXT kind: POST /api/creatives/:id/versions/text `{ textBody }` — READY
 *    immediately, no asset.
 * The mode is derived from the creative kind because the API rejects
 * TEXT_USES_PASTE (binary upload on text) and TEXT_KIND_MISMATCH (paste on
 * binary). XHR progress via uploadWithProgress.
 */
export function UploadView({ creativeId }: { creativeId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [textBody, setTextBody] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<Status>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const { data: creative, isLoading, isError } = useQuery({
    queryKey: ['creative', creativeId],
    queryFn: () => apiFetch<Creative>(`/api/creatives/${creativeId}`),
  });

  const isText = creative?.kind === 'TEXT';

  function handleFiles(files: FileList | null) {
    const selected = files?.[0];
    if (!selected) return;
    if (selected.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`El archivo supera los ${MAX_SIZE_MB}MB permitidos.`);
      return;
    }
    setError(null);
    setFile(selected);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    handleFiles(e.dataTransfer.files);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (isText) {
      if (!textBody.trim()) {
        setError('Escribí el contenido de esta versión.');
        return;
      }
      try {
        setStatus('UPLOADING');
        await apiFetch<{ id: string }>(`/api/creatives/${creativeId}/versions/text`, {
          method: 'POST',
          body: { textBody: textBody.trim() },
        });
        setStatus('DONE');
      } catch (err) {
        setStatus('ERROR');
        setError(err instanceof ApiError ? err.message : 'No pudimos guardar la versión.');
      }
      return;
    }

    if (!file) {
      setError('Seleccioná un archivo para subir.');
      return;
    }

    try {
      setStatus('UPLOADING');
      const formData = new FormData();
      formData.append('file', file);
      await uploadWithProgress<{ id: string }>(`/api/creatives/${creativeId}/versions`, {
        body: formData,
        onProgress: setProgress,
      });
      setStatus('DONE');
    } catch (err) {
      setStatus('ERROR');
      setError(err instanceof ApiError ? err.message : 'No pudimos subir la versión.');
    }
  }

  if (status === 'DONE') {
    return (
      <div className="upload-wrap">
        <div className="upload-success">
          <i className="ti ti-circle-check" aria-hidden="true" />
          <h3>Versión subida</h3>
          <p>
            {isText
              ? 'La nueva versión de texto ya está disponible.'
              : 'El archivo está en cola de procesamiento. En unos segundos vas a poder verlo desde el detalle del creativo.'}
          </p>
          <button className="btn primary" onClick={() => router.push(`/creatives/${creativeId}`)}>
            Ver detalle del creativo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="breadcrumb">{creative ? `${creative.title} / nueva versión` : 'Nueva versión'}</div>

      <div className="upload-wrap">
        <form onSubmit={handleSubmit}>
          {isText ? (
            <textarea
              className="version-note"
              style={{ minHeight: 140 }}
              placeholder="Pegá el contenido de texto de esta versión…"
              value={textBody}
              onChange={(e) => setTextBody(e.target.value)}
            />
          ) : (
            <div
              className={dragActive ? 'dropzone drag-active' : 'dropzone'}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                hidden
                onChange={(e) => handleFiles(e.target.files)}
              />
              {file ? (
                <>
                  <i className="ti ti-file-check" aria-hidden="true" />
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{file.name}</div>
                  <div className="hint">{(file.size / (1024 * 1024)).toFixed(1)}MB — hacé clic para cambiar</div>
                </>
              ) : (
                <>
                  <i className="ti ti-cloud-upload" aria-hidden="true" />
                  <div style={{ fontSize: 14, fontWeight: 500 }}>Arrastrá tu archivo o hacé clic para buscar</div>
                  <div className="hint">Imágenes y video hasta {MAX_SIZE_MB}MB</div>
                </>
              )}
            </div>
          )}

          {error && <p className="field-error">{error}</p>}

          {status === 'UPLOADING' && !isText && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          )}

          <button
            type="submit"
            className="btn primary"
            style={{ marginTop: 14, width: '100%' }}
            disabled={status === 'UPLOADING' || isLoading || isError}
          >
            {status === 'UPLOADING'
              ? isText
                ? 'Guardando…'
                : `Subiendo… ${progress}%`
              : 'Subir nueva versión'}
          </button>
        </form>
      </div>
    </div>
  );
}
