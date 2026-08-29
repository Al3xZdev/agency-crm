'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/api';
import { ROLE_OPTIONS, roleLabel } from '../../lib/roles';
import { StaffMember, StaffRole } from '../../lib/types';

/**
 * Backend-adapted: there is no `/api/staff/invite` — POST /api/staff creates
 * the account directly and requires `{ email, password, displayName, role }`
 * (password min 10 chars). The "sent" success state is kept, reworded to
 * reflect that credentials were created, not emailed.
 */
export function InviteUserModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<StaffRole>('ACCOUNT_MANAGER');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<StaffMember>('/api/staff', {
        method: 'POST',
        body: { email: email.trim(), password, displayName: displayName.trim(), role },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-users'] });
      setCreated(true);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'No pudimos crear el usuario.');
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Ingresá un correo válido.');
      return;
    }
    if (!displayName.trim()) {
      setError('Ingresá un nombre para el usuario.');
      return;
    }
    if (password.length < 10) {
      setError('La contraseña debe tener al menos 10 caracteres.');
      return;
    }
    mutation.mutate();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Nuevo usuario</h3>

        {created ? (
          <div className="upload-success" style={{ padding: '30px 10px' }}>
            <i className="ti ti-user-check" aria-hidden="true" />
            <p style={{ margin: '10px 0 20px' }}>
              Creamos el usuario <strong>{displayName.trim()}</strong> ({email.trim()}) como{' '}
              {roleLabel(role).toLowerCase()}.
            </p>
            <button className="btn primary" onClick={onClose}>
              Listo
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="invite-name">Nombre</label>
              <input
                id="invite-name"
                type="text"
                autoFocus
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="María López"
              />
            </div>
            <div className="field">
              <label htmlFor="invite-email">Correo</label>
              <input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nuevo@agencia.com"
              />
            </div>
            <div className="field">
              <label htmlFor="invite-password">Contraseña inicial</label>
              <input
                id="invite-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 10 caracteres"
              />
            </div>
            <div className="field">
              <label>Rol</label>
              <div className="type-toggle">
                {ROLE_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={role === option.value ? 'chip active' : 'chip'}
                    onClick={() => setRole(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="field-error">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="btn primary" disabled={mutation.isPending}>
                {mutation.isPending ? 'Creando…' : 'Crear usuario'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}