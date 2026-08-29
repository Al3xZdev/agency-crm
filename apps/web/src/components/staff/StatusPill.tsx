import { CreativeStatus } from '../../lib/types';

/**
 * Backend CreativeStatus pill — maps all 7 schema.prisma values. The
 * reference's PENDING/REQUEST_CHANGES do not exist in the API; the backend
 * uses IN_REVIEW / CHANGES_REQUESTED / UPLOAD_FAILED / DRAFT instead.
 */
const CONFIG: Record<CreativeStatus, { label: string; className: string; icon: string }> = {
  DRAFT: { label: 'borrador', className: 'pill processing', icon: 'pencil' },
  PROCESSING: { label: 'procesando', className: 'pill processing', icon: 'loader-2' },
  IN_REVIEW: { label: 'en revisión', className: 'pill pending', icon: 'clock' },
  APPROVED: { label: 'aprobado', className: 'pill approved', icon: 'check' },
  REJECTED: { label: 'rechazado', className: 'pill rejected', icon: 'x' },
  CHANGES_REQUESTED: { label: 'cambios solicitados', className: 'pill pending', icon: 'repeat' },
  UPLOAD_FAILED: { label: 'subida fallida', className: 'pill rejected', icon: 'alert-triangle' },
};

export function StatusPill({ status }: { status: CreativeStatus }) {
  const config = CONFIG[status];
  return (
    <span className={config.className}>
      <i className={`ti ti-${config.icon}`} aria-hidden="true" />
      {config.label}
    </span>
  );
}