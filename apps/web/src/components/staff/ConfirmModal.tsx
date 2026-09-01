'use client';

import { ReactNode } from 'react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmIcon?: string;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Reusable destructive/non-destructive confirmation dialog. Follows the
 * `.modal-overlay` / `.modal` pattern: clicking the overlay cancels, the inner
 * `.modal` stops propagation, and `.modal-actions` right-aligns the buttons.
 * Rendered only when `open` is true.
 */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Eliminar',
  cancelLabel = 'Cancelar',
  confirmIcon,
  busy = false,
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className={`modal modal-destructive${danger ? '' : ' modal-destructive-safe'}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        <div className="modal-subtitle">{message}</div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'btn red' : 'btn primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmIcon && <i className={confirmIcon} aria-hidden="true" />}
            {busy ? 'Procesando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
