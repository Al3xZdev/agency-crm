'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../../lib/api';
import { useStaffSession } from '../../../lib/auth';
import { StaffUser } from '../../../lib/types';

/**
 * Security tab (PR5). PATCH /api/staff/me updates the own displayName;
 * POST /api/staff/change-password verifies the current password and sets a
 * new one (min 10 chars). Backend-adapted: `displayName` (not `name`) and a
 * 10-char password floor.
 */
export function SecurityTab() {
  const { data: session, isLoading } = useStaffSession();

  if (isLoading || !session) return <div className="settings-card skeleton-row" style={{ height: 140 }} />;

  return (
    <div>
      <ProfileCard session={session} />
      <ChangePasswordCard />
    </div>
  );
}

function ProfileCard({ session }: { session: StaffUser }) {
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (session) setName(session.displayName);
  }, [session]);

  const updateName = useMutation({
    mutationFn: () =>
      apiFetch<StaffUser>('/api/staff/me', { method: 'PATCH', body: { displayName: name.trim() } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['staff-session'], updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No pudimos guardar el nombre.'),
  });

  function handleNameSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('El nombre no puede estar vacío.');
      return;
    }
    updateName.mutate();
  }

  return (
    <div className="settings-card">
      <h3>Tu información</h3>
      <form onSubmit={handleNameSubmit} className="settings-form">
        <div className="field">
          <label htmlFor="profile-name">Nombre</label>
          <input id="profile-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Correo</label>
          <input type="text" value={session.email} disabled />
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="settings-form-actions">
          {saved && (
            <span className="saved-hint">
              <i className="ti ti-check" aria-hidden="true" /> Guardado
            </span>
          )}
          <button type="submit" className="btn primary" disabled={updateName.isPending || name.trim() === session.displayName}>
            {updateName.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/staff/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
    onSuccess: () => {
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setSuccess(false), 3000);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'No pudimos cambiar la contraseña.');
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 10) {
      setError('La nueva contraseña debe tener al menos 10 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    mutation.mutate();
  }

  return (
    <div className="settings-card">
      <h3>Cambiar contraseña</h3>
      <form onSubmit={handleSubmit} className="settings-form">
        <div className="field">
          <label htmlFor="current-password">Contraseña actual</label>
          <input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="new-password">Nueva contraseña</label>
          <input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="confirm-password">Confirmar nueva contraseña</label>
          <input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="settings-form-actions">
          {success && (
            <span className="saved-hint">
              <i className="ti ti-check" aria-hidden="true" /> Contraseña actualizada
            </span>
          )}
          <button type="submit" className="btn primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Guardando…' : 'Actualizar contraseña'}
          </button>
        </div>
      </form>
    </div>
  );
}
