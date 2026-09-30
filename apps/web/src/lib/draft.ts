// The generator's unsaved values, kept in this browser while its user goes through sign-in (the
// link usually opens in a new tab), so they can save them as a SKU once signed in. Stored only
// on the way to the sign-in page, used once, and ignored after an hour.
import type { FormState } from './request';

const KEY = 'energy-panel:pending-draft';
const MAX_AGE_MS = 60 * 60 * 1000;

export interface Draft {
  form: FormState;
  producer: string;
  sku: string;
  batch: string;
  /** The saved SKU these values change, if any. */
  skuId: string | null;
}

export function storeDraft(draft: Draft): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), draft }));
  } catch {
    // Storage can be unavailable (private browsing, quotas): the values are simply not kept.
  }
}

/** The pending draft, if one was stored within the hour. Leaves it in place. */
export function pendingDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { savedAt, draft } = JSON.parse(raw) as { savedAt: number; draft: Draft };
    if (!(Date.now() - savedAt < MAX_AGE_MS) || typeof draft !== 'object' || !draft) return null;
    const text = (value: unknown) => (typeof value === 'string' ? value : '');
    return {
      form: draft.form,
      producer: text(draft.producer),
      sku: text(draft.sku),
      batch: text(draft.batch),
      skuId: typeof draft.skuId === 'string' ? draft.skuId : null,
    };
  } catch {
    return null;
  }
}

/** Takes the pending draft: it is removed, so it fills the generator once. */
export function takeDraft(): Draft | null {
  const draft = pendingDraft();
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to remove.
  }
  return draft;
}

/** Copies the stored values that match the form's fields and types onto a fresh form. */
export function restoreForm(base: FormState, stored: Partial<FormState>): FormState {
  const form = { ...base };
  for (const key of Object.keys(base) as Array<keyof FormState>) {
    const value = stored[key];
    if (value !== undefined && typeof value === typeof base[key]) {
      (form as Record<string, unknown>)[key] = value;
    }
  }
  return form;
}
