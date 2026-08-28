import { StaffRole } from './types';

export const ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: 'SUPER_ADMIN', label: 'Administrador' },
  { value: 'ACCOUNT_MANAGER', label: 'Gestor de cuentas' },
  { value: 'CREATIVE', label: 'Creativo' },
];

export function roleLabel(role: StaffRole): string {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}