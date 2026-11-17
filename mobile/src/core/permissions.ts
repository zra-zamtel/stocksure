import type { Role } from './types';

/**
 * The role matrix from section 3 of the scope sheet, written once. Screens use
 * it to hide a control, route guards use it to block a deep link, and actions
 * use it again before writing, so a hidden button is never the only protection.
 */
export type Permission =
  | 'sales.record'
  | 'sales.view'
  | 'stock.view'
  | 'cash.count'
  /** Buy prices, profit and discounts given. */
  | 'money.insights'
  | 'products.manage'
  /** Approve selling more than is on hand. */
  | 'stock.override'
  | 'sales.void'
  | 'reconcile.resolve'
  | 'tax.view'
  | 'settings.view'
  | 'staff.manage';

const GRANTS: Record<Role, readonly Permission[]> = {
  owner: [
    'sales.record',
    'sales.view',
    'stock.view',
    'cash.count',
    'money.insights',
    'products.manage',
    'stock.override',
    'sales.void',
    'reconcile.resolve',
    'tax.view',
    'settings.view',
    'staff.manage',
  ],
  staff: ['sales.record', 'sales.view', 'stock.view', 'cash.count'],
};

export class PermissionError extends Error {
  constructor(public readonly permission: Permission) {
    super(`This account cannot ${permission}.`);
    this.name = 'PermissionError';
  }
}

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return role ? GRANTS[role].includes(permission) : false;
}

/** Throws instead of silently continuing when an action bypasses the UI. */
export function assertCan(role: Role | null | undefined, permission: Permission): void {
  if (!can(role, permission)) throw new PermissionError(permission);
}

/**
 * Owner-only screens. Keeping the route name and its permission together lets
 * the navigator and the screen's own controls agree without duplicating a list.
 */
export const SCREEN_PERMISSIONS = {
  settings: 'settings.view',
  staff: 'staff.manage',
  tax: 'tax.view',
  taxPot: 'tax.view',
  productNew: 'products.manage',
  productDetail: 'products.manage',
  scan: 'products.manage',
} as const satisfies Record<string, Permission>;

export type ProtectedScreen = keyof typeof SCREEN_PERMISSIONS;

export function canAccessScreen(
  role: Role | null | undefined,
  screen: ProtectedScreen
): boolean {
  return can(role, SCREEN_PERMISSIONS[screen]);
}
