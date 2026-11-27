import { describe, expect, it } from 'vitest';
import { pressKey } from './keypad';

describe('pressKey', () => {
  it('appends digits', () => {
    expect(pressKey('', '1')).toBe('1');
    expect(pressKey('12', '3')).toBe('123');
  });

  it('allows at most one point', () => {
    expect(pressKey('12', '.')).toBe('12.');
    expect(pressKey('12.5', '.')).toBe('12.5');
  });

  it('allows at most two digits after the point', () => {
    expect(pressKey('12.3', '4')).toBe('12.34');
    expect(pressKey('12.34', '5')).toBe('12.34');
  });

  it('allows at most maxWhole digits before the point', () => {
    expect(pressKey('1234567', '8')).toBe('1234567');
    expect(pressKey('123', '4', 3)).toBe('123');
    expect(pressKey('1234567', '.')).toBe('1234567.');
  });

  it('turns a leading point into 0.', () => {
    expect(pressKey('', '.')).toBe('0.');
  });

  it('collapses leading zeros', () => {
    expect(pressKey('0', '5')).toBe('5');
    expect(pressKey('0', '0')).toBe('0');
    expect(pressKey('0.', '5')).toBe('0.5');
    expect(pressKey('0.', '0')).toBe('0.0');
  });

  it('back removes the last character', () => {
    expect(pressKey('125.5', 'back')).toBe('125.');
    expect(pressKey('0.', 'back')).toBe('0');
    expect(pressKey('', 'back')).toBe('');
  });
});
