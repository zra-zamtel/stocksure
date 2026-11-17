import type { ReactNode } from 'react';
import { assertCan, type Permission } from '@/core';
import { useAuth } from './session';

/**
 * Hides a control using the same matrix the route guard and the action check
 * use. Never rely on a hidden button alone: pass the permission to `guard()`
 * before the write as well.
 */
export function PermissionGate({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = useAuth();
  return can(permission) ? children : fallback;
}

/** Throws a PermissionError before a screen writes on behalf of the wrong role. */
export function usePermissionGuard() {
  const { user } = useAuth();
  return (permission: Permission) => assertCan(user?.role, permission);
}
