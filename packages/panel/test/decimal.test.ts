import { describe, expect, it } from 'vitest';
import {
  countSignificantFigures,
  formatFixed,
  formatSignificant,
  formatUpTo,
  isWholeNumber,
} from '../src/index.ts';

describe('formatSignificant (energy values)', () => {
  it.each([
    [355.2, '355'],
    [592, '592'],
    [84.89, '84.9'],
    [1234.5, '1230'],
    [1235, '1240'],
    [290.5, '291'],
    [999.5, '1000'],
    [0.012345, '0.0123'],
    [50, '50'],
    [5, '5'],
    [0, '0'],
  ])('%s → %s', (value, expected) => {
    expect(formatSignificant(value, 3)).toBe(expected);
  });

  it('rounds the decimal value half up, not its binary approximation', () => {
    // 84.85 is stored as 84.8499999…; toPrecision rounds that down.
    expect((84.85).toPrecision(3)).toBe('84.8');
    expect(formatSignificant(84.85, 3)).toBe('84.9');
  });

  it('never adds trailing precision', () => {
    expect(formatSignificant(12.04, 3)).toBe('12');
    expect(formatSignificant(1.5, 3)).toBe('1.5');
    expect(formatSignificant(70.985, 3)).toBe('71');
  });

  it('honours fewer figures when asked', () => {
    expect(formatSignificant(355.2, 2)).toBe('360');
  });
});

describe('formatFixed (standard drinks)', () => {
  it.each([
    [0.998874, '1.0'],
    [1.4202, '1.4'],
    [39.45, '39.5'],
    [7, '7.0'],
    [0.04, '0.0'],
  ])('%s → %s', (value, expected) => {
    expect(formatFixed(value, 1)).toBe(expected);
  });

  it('rounds 118.35 up although the stored double is 118.3499…', () => {
    expect((118.35).toFixed(1)).toBe('118.3');
    expect(formatFixed(118.35, 1)).toBe('118.4');
  });
});

describe('formatUpTo and isWholeNumber', () => {
  it('drops trailing zeros', () => {
    expect(formatUpTo(60, 1)).toBe('60');
    expect(formatUpTo(37.55, 1)).toBe('37.6');
    expect(formatUpTo(23.333, 1)).toBe('23.3');
  });

  it('recognises whole numbers despite binary noise', () => {
    expect(isWholeNumber(750 / 150)).toBe(true);
    expect(isWholeNumber(0.1 * 3 * 10)).toBe(true);
    expect(isWholeNumber(700 / 30)).toBe(false);
  });
});

describe('countSignificantFigures', () => {
  it.each([
    ['355', 3],
    ['1230', 3],
    ['1000', 1],
    ['84.9', 3],
    ['12.0', 3],
    ['0.0123', 3],
    ['5', 1],
  ])('%s has %i', (displayed, figures) => {
    expect(countSignificantFigures(displayed)).toBe(figures);
  });
});
