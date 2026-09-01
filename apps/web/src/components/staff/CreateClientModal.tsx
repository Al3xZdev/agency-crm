'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';

/**
 * Backend-adapted: POST /api/clients returns `{ id }` (created row), so the
 * callback carries id + the name typed in the form — not a full Client.
 *
 * Redesign: two-column contact fields plus a collapsible "Más detalles"
 * section, ported from the WIP and adapted to this repo's backend field names
 * (`email` not `contactEmail`) and vocabulary ("Contacto principal", etc.).
 */
const INDUSTRY_OPTIONS = [
  'Inmobiliaria',
  'Retail',
  'Gastronomía',
  'Salud',
  'Educación',
  'Servicios profesionales',
  'Otro',
];

interface FormState {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  industry: string;
  notes: string;
}

const EMPTY_FORM: FormState = { name: '', contactName: '', email: '', phone: '', industry: '', notes: '' };

export function CreateClientModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (client: { id: string; name: string }) => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>('/api/clients', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          contactName: form.contactName.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          industry: form.industry || undefined,
          notes: form.notes.trim() || undefined,
        },
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      showToast(`Cliente "${form.name.trim()}" creado`);
      onCreated({ id: created.id, name: form.name.trim() });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'No pudimos crear el cliente.');
    },
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.name.trim()) {
      setError('Ingresá el nombre del cliente.');
      return;
    }
    if (!form.contactName.trim()) {
      setError('Ingresá el nombre de la persona de contacto.');
      return;
    }
    const email = form.email.trim();
    if (!email) {
      setError('Ingresá un email de contacto.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError('Ingresá un email válido.');
      return;
    }
    mutation.mutate();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Nuevo cliente</h3>
        <p className="modal-subtitle">Estos datos definen a quién le llega el link mágico y las notificaciones.</p>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="client-name">Nombre del cliente o empresa</label>
            <input
              id="client-name"
              type="text"
              autoFocus
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="Inmobiliaria Sur"
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="client-contact-name">Contacto principal</label>
              <input
                id="client-contact-name"
                type="text"
                value={form.contactName}
                onChange={(e) => update('contactName', e.target.value)}
                placeholder="Carla Ríos"
              />
            </div>
            <div className="field">
              <label htmlFor="client-contact-email">Email de contacto</label>
              <input
                id="client-contact-email"
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="carla@inmobiliariasur.com"
              />
            </div>
          </div>

          <button type="button" className="link-btn more-details-toggle" onClick={() => setShowMore((s) => !s)}>
            <i className={showMore ? 'ti ti-chevron-up' : 'ti ti-chevron-down'} aria-hidden="true" />
            {showMore ? 'Ocultar detalles' : 'Más detalles (opcional)'}
          </button>

          {showMore && (
            <div className="more-details">
              <div className="field-row">
                <div className="field">
                  <label htmlFor="client-phone">Teléfono / WhatsApp</label>
                  <input
                    id="client-phone"
                    type="text"
                    value={form.phone}
                    onChange={(e) => update('phone', e.target.value)}
                    placeholder="+57 300 000 0000"
                  />
                </div>
                <div className="field">
                  <label htmlFor="client-industry">Rubro</label>
                  <select id="client-industry" value={form.industry} onChange={(e) => update('industry', e.target.value)}>
                    <option value="">Sin especificar</option>
                    {INDUSTRY_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="client-notes">Notas internas</label>
                <textarea
                  id="client-notes"
                  className="version-note"
                  style={{ margin: 0, minHeight: 70 }}
                  placeholder="Cosas que el equipo debería saber sobre este cliente…"
                  value={form.notes}
                  onChange={(e) => update('notes', e.target.value)}
                />
              </div>
            </div>
          )}

          {error && <p className="field-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creando…' : 'Crear cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
