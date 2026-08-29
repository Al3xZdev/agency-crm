'use client';

import { useState } from 'react';
import { AgencyTab } from './AgencyTab';
import { StaffTab } from './StaffTab';
import { SecurityTab } from './SecurityTab';

type Tab = 'agency' | 'staff' | 'security';

const TABS: { value: Tab; label: string; icon: string }[] = [
  { value: 'agency', label: 'Agencia', icon: 'ti ti-building' },
  { value: 'staff', label: 'Staff', icon: 'ti ti-users' },
  { value: 'security', label: 'Seguridad', icon: 'ti ti-shield-lock' },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('agency');

  return (
    <div>
      <div className="staff-topbar">
        <h2>Configuración</h2>
      </div>

      <div className="settings-tabs">
        {TABS.map((t) => (
          <button
            key={t.value}
            className={tab === t.value ? 'settings-tab active' : 'settings-tab'}
            onClick={() => setTab(t.value)}
          >
            <i className={t.icon} aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="settings-panel">
        {tab === 'agency' && <AgencyTab />}
        {tab === 'staff' && <StaffTab />}
        {tab === 'security' && <SecurityTab />}
      </div>
    </div>
  );
}
