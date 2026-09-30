import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pendingDraft, restoreForm, storeDraft, takeDraft, type Draft } from './draft';
import type { FormState } from './request';

const base: FormState = {
  beverage: 'wine',
  abv: '',
  packageMl: '',
  serving: '100',
  servingCustom: '',
  servings: '',
  kj: '',
  cal: '',
  area: '',
  nip: false,
  standardised: '',
  width: '50',
  widthCustom: '',
  colour: 'black',
  units: 'kj',
  packageWord: 'bottle',
  packageWordCustom: '',
};

const draft: Draft = {
  form: { ...base, abv: '13.5', packageMl: '750', kj: '316' },
  producer: 'Château Lune',
  sku: 'Reserve',
  batch: '2024',
  skuId: null,
};

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('sign-in draft', () => {
  it('is kept once: taking it removes it', () => {
    storeDraft(draft);
    expect(pendingDraft()).toEqual(draft);
    expect(takeDraft()).toEqual(draft);
    expect(takeDraft()).toBeNull();
  });

  it('is ignored after an hour', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T02:00:00Z'));
    storeDraft({ ...draft, skuId: 'sku-1' });
    vi.setSystemTime(new Date('2026-09-30T02:59:00Z'));
    expect(pendingDraft()?.skuId).toBe('sku-1');
    vi.setSystemTime(new Date('2026-09-30T03:00:01Z'));
    expect(pendingDraft()).toBeNull();
  });

  it('survives storage that is unavailable or holds something else', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => undefined,
    });
    expect(() => storeDraft(draft)).not.toThrow();
    expect(takeDraft()).toBeNull();
  });

  it('restores only known fields of the right type onto a fresh form', () => {
    const restored = restoreForm(base, {
      abv: '13.5',
      nip: 'yes' as never,
      width: 60 as never,
      extra: 'x',
    } as Partial<FormState>);
    expect(restored).toEqual({ ...base, abv: '13.5' });
  });
});
