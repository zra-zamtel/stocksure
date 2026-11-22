import { describe, expect, it } from 'vitest';
import {
  PermissionError,
  assertCan,
  can,
  canAccessScreen,
  type Permission,
} from './permissions';

const OWNER_ONLY: Permission[] = [
  'money.insights',
  'products.manage',
  'stock.override',
  'sales.void',
  'reconcile.resolve',
  'tax.view',
  'settings.view',
  'staff.manage',
];

const SHARED: Permission[] = ['sales.view', 'stock.view', 'cash.count'];

describe('role permission matrix', () => {
  it('keeps recording sales for staff only', () => {
    expect(can('staff', 'sales.record')).toBe(true);
    expect(can('owner', 'sales.record')).toBe(false);
    expect(canAccessScreen('staff', 'saleNew')).toBe(true);
    expect(canAccessScreen('owner', 'saleNew')).toBe(false);
  });

  it('lets the owner use every other action and open every owner screen', () => {
    for (const permission of [...OWNER_ONLY, ...SHARED]) {
      expect(can('owner', permission)).toBe(true);
    }
    expect(canAccessScreen('owner', 'settings')).toBe(true);
    expect(canAccessScreen('owner', 'staff')).toBe(true);
    expect(canAccessScreen('owner', 'tax')).toBe(true);
    expect(canAccessScreen('owner', 'taxPot')).toBe(true);
    expect(canAccessScreen('owner', 'insights')).toBe(true);
    expect(canAccessScreen('owner', 'productNew')).toBe(true);
    expect(canAccessScreen('owner', 'productDetail')).toBe(true);
    expect(canAccessScreen('owner', 'scan')).toBe(true);
  });

  it('gives staff the counter actions only', () => {
    for (const permission of SHARED) {
      expect(can('staff', permission)).toBe(true);
    }
    for (const permission of OWNER_ONLY) {
      expect(can('staff', permission)).toBe(false);
    }
  });

  it('blocks every owner-only screen for staff, including by deep link', () => {
    expect(canAccessScreen('staff', 'settings')).toBe(false);
    expect(canAccessScreen('staff', 'staff')).toBe(false);
    expect(canAccessScreen('staff', 'tax')).toBe(false);
    expect(canAccessScreen('staff', 'taxPot')).toBe(false);
    expect(canAccessScreen('staff', 'insights')).toBe(false);
    expect(canAccessScreen('staff', 'paymentMessage')).toBe(false);
    expect(canAccessScreen('staff', 'productNew')).toBe(false);
    expect(canAccessScreen('staff', 'productDetail')).toBe(false);
    expect(canAccessScreen('staff', 'scan')).toBe(false);
  });

  it('treats a signed-out session as having no permission', () => {
    expect(can(null, 'sales.record')).toBe(false);
    expect(can(undefined, 'settings.view')).toBe(false);
    expect(canAccessScreen(null, 'tax')).toBe(false);
  });

  it('throws when an action checks the permission directly', () => {
    expect(() => assertCan('owner', 'sales.void')).not.toThrow();
    expect(() => assertCan('staff', 'sales.void')).toThrow(PermissionError);
  });
});
