import { CampaignStatus } from '../../lib/types';

const CONFIG: Record<CampaignStatus, { label: string; className: string; icon: string }> = {
  ACTIVE: { label: 'activa', className: 'pill camp-active', icon: 'play' },
  PAUSED: { label: 'pausada', className: 'pill camp-paused', icon: 'pause' },
  ARCHIVED: { label: 'archivada', className: 'pill camp-archived', icon: 'archive' },
};

export function CampaignStatusPill({ status }: { status: CampaignStatus }) {
  const config = CONFIG[status];
  return (
    <span className={config.className}>
      <i className={`ti ti-${config.icon}`} aria-hidden="true" />
      {config.label}
    </span>
  );
}