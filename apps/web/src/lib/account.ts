// Account types and requests shared by the pages. The session is an HttpOnly cookie, so the page
// never sees it: it asks the API who is signed in.
import type { BeverageTypeId, StatementInputs, StatementOptions } from '@energy-panel/panel';

export interface Account {
  id: string;
  email: string;
  orgName: string | null;
  role: 'producer' | 'printer' | 'designer';
  plan: string;
  freeExportAvailable: boolean;
}

export interface Sku {
  id: string;
  name: string;
  /** Names the files and appears on the proof; the account's organisation fills it by default. */
  producer: string | null;
  beverageType: BeverageTypeId | null;
  vintageOrBatch: string | null;
  inputs: StatementInputs;
  options: StatementOptions;
  createdAt: string;
  updatedAt: string;
}

export interface SkuSummary extends Sku {
  exportCount: number;
  lastExport: { createdAt: string; rulesVersion: string } | null;
}

export interface StoredExport {
  id: string;
  skuId: string;
  createdAt: string;
  issuedOn: string;
  rulesVersion: string;
  watermarked: boolean;
  outputHash: string;
  files: Array<{ kind: string; fileName: string; url: string }>;
}

/** JSON request to the API; returns the parsed body and status, never throws on 4xx. */
export async function api<T = any>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(`/api/${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const data = res.headers.get('content-type')?.includes('application/json')
    ? await res.json()
    : null;
  return { ok: res.ok, status: res.status, data: data as T };
}

/** "30 Sep 2026" */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
