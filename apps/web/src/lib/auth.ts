'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiFetch } from './api';
import type { StaffUser } from './types';

/**
 * Staff session — GET /api/staff/session.
 * Long staleTime + no retry: the sidebar renders immediately from a cached
 * session and 401s are handled by the apiFetch redirect instead.
 */
export function useStaffSession() {
  return useQuery({
    queryKey: ['staff-session'],
    queryFn: () => apiFetch<StaffUser>('/api/staff/session'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/**
 * Logout — POST /api/auth/logout (the backend has no /api/staff/logout).
 * Clears the react-query cache so no staff data leaks into a new session.
 */
export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    queryClient.clear();
    router.push('/login');
    router.refresh();
  };
}