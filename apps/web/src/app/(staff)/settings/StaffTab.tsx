'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api';
import { useStaffSession } from '../../../lib/auth';
import { StaffMember, StaffRole } from '../../../lib/types';
import { ROLE_OPTIONS, roleLabel } from '../../../lib/roles';
import { InviteUserModal } from '../../../components/staff/InviteUserModal';

/**
 * Staff management tab (PR5). Data: GET /api/staff (SUPER_ADMIN only); role
 * and isActive changes via PATCH /api/staff/:id; new users via InviteUserModal
 * (POST /api/staff).
 *
 * Backend adaptation: the list uses `displayName`/`isActive` (not `name`/
 * `active`) and the PATCH body is `{ role, isActive }`. Because GET /api/staff
 * is SUPER_ADMIN-only, non-admins see a read-only note instead of a 401
 * redirect bouncing them to /login.
 */
export function StaffTab() {
  const { data: session } = useStaffSession();
  const [showInvite, setShowInvite] = useState(false);
  const [roleMenuFor, setRoleMenuFor] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const isAdmin = session?.role === 'SUPER_ADMIN';

  const { data: users, isLoading, isError, refetch } = useQuery({
    queryKey: ['staff-users'],
    queryFn: () => apiFetch<StaffMember[]>('/api/staff'),
    enabled: isAdmin,
  });

  const updateRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: StaffRole }) =>
      apiFetch<StaffMember>(`/api/staff/${userId}`, { method: 'PATCH', body: { role } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-users'] });
      setRoleMenuFor(null);
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ userId, active }: { userId: string; active: boolean }) =>
      apiFetch<StaffMember>(`/api/staff/${userId}`, { method: 'PATCH', body: { isActive: active } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff-users'] }),
  });

  if (!isAdmin) {
    return (
      <div className="settings-card">
        <h3>Usuarios del staff</h3>
        <p className="modal-subtitle" style={{ margin: 0 }}>
          Solo un administrador puede gestionar los usuarios del staff.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="settings-card-header">
        <div>
          <h3>Usuarios del staff</h3>
          <p className="modal-subtitle" style={{ margin: 0 }}>
            Gestioná quién tiene acceso y con qué rol.
          </p>
        </div>
        <button className="btn primary" onClick={() => setShowInvite(true)}>
          <i className="ti ti-user-plus" aria-hidden="true" />
          Invitar usuario
        </button>
      </div>

      {isError && (
        <div className="error-banner">
          <span>No pudimos cargar los usuarios.</span>
          <button onClick={() => refetch()}>Reintentar</button>
        </div>
      )}

      <div className="list-card" style={{ marginTop: 16 }}>
        <div className="list-row users-row list-head">
          <div>Nombre</div>
          <div>Email</div>
          <div>Rol</div>
          <div>Estado</div>
          <div></div>
        </div>
        {isLoading &&
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="list-row skeleton-row" />)}
        {users?.map((user) => (
          <div key={user.id} className={user.isActive ? 'list-row users-row' : 'list-row users-row inactive'}>
            <div>{user.displayName}</div>
            <div className="muted mono">{user.email}</div>
            <div className="role-menu-wrap">
              <button className="chip" onClick={() => setRoleMenuFor(roleMenuFor === user.id ? null : user.id)}>
                {roleLabel(user.role)}
                <i className="ti ti-chevron-down" aria-hidden="true" />
              </button>
              {roleMenuFor === user.id && (
                <>
                  <div className="status-menu-backdrop" onClick={() => setRoleMenuFor(null)} />
                  <div className="status-menu">
                    {ROLE_OPTIONS.filter((r) => r.value !== user.role).map((option) => (
                      <button
                        key={option.value}
                        onClick={() => updateRole.mutate({ userId: user.id, role: option.value })}
                        disabled={updateRole.isPending}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div>
              <span className={user.isActive ? 'pill approved' : 'pill processing'}>
                {user.isActive ? 'activo' : 'inactivo'}
              </span>
            </div>
            <div className="link-actions">
              <button
                className="btn ghost"
                onClick={() => toggleActive.mutate({ userId: user.id, active: !user.isActive })}
                disabled={toggleActive.isPending}
              >
                {user.isActive ? 'Desactivar' : 'Reactivar'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {showInvite && <InviteUserModal onClose={() => setShowInvite(false)} />}
    </div>
  );
}
