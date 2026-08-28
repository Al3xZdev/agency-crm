'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useLogout } from '../../lib/auth';
import { roleLabel } from '../../lib/roles';
import type { StaffUser } from '../../lib/types';

const NAV_ITEMS: { href: string; label: string; icon: string }[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'ti ti-layout-dashboard' },
  { href: '/clients', label: 'Clientes', icon: 'ti ti-users' },
  { href: '/campaigns', label: 'Campañas', icon: 'ti ti-bullhorn' },
  { href: '/creatives', label: 'Creativos', icon: 'ti ti-photo' },
  { href: '/magic-links', label: 'Magic Links', icon: 'ti ti-link' },
  { href: '/settings', label: 'Ajustes', icon: 'ti ti-settings' },
];

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');
}

export function Sidebar({ user }: { user: StaffUser }) {
  const pathname = usePathname();
  const [confirming, setConfirming] = useState(false);
  const logout = useLogout();

  return (
    <aside className="staff-side">
      <div className="brand">Agencia CRM</div>
      <div className="brand-sub">proofing desk</div>
      <nav>
        {NAV_ITEMS.map((item) => (
          <Link key={item.href} href={item.href} className={`nav-link ${pathname.startsWith(item.href) ? 'active' : ''}`}>
            <i className={item.icon} />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="avatar-sm">{initials(user.displayName)}</div>
          <div>
            <div className="sidebar-user-name">{user.displayName}</div>
            <div className="sidebar-user-role">{roleLabel(user.role)}</div>
          </div>
        </div>

        {confirming ? (
          <div className="confirm-inline" style={{ justifyContent: 'space-between' }}>
            <button className="btn" onClick={() => setConfirming(false)}>
              Cancelar
            </button>
            <button className="btn red" onClick={() => void logout()}>
              Salir
            </button>
          </div>
        ) : (
          <button className="btn" onClick={() => setConfirming(true)}>
            <i className="ti ti-logout" />
            Cerrar sesión
          </button>
        )}
      </div>
    </aside>
  );
}