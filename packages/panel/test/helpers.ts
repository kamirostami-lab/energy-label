import rulesJson from '../../../rules/fsanz-energy-statement.json' with { type: 'json' };
import {
  loadFsanzEnergyStatementRules,
  parseRules,
  type EnergyStatementRules,
} from '@energy-panel/rules';
import type { StatementInputs, StatementOptions } from '../src/index.ts';

export const rules = loadFsanzEnergyStatementRules();

/** The rules file with changes applied to a copy of its JSON, re-validated. */
export function rulesWith(change: (json: any) => void): EnergyStatementRules {
  const json = structuredClone(rulesJson) as any;
  change(json);
  return parseRules(json);
}

/** The FSANZ guidance example (Build Brief 01 section 9). */
export const fsanzInputs: StatementInputs = {
  abv: 21.1,
  package_ml: 720,
  serving_ml: 60,
  kj_per_100ml: 592,
};

export const defaultOptions: StatementOptions = { width_mm: 50 };

/** Deterministic pseudo-random numbers (mulberry32) so failures can be replayed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
