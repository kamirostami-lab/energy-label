import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkRulesChange } from './check-rules-change.mjs';

const current = JSON.parse(
  readFileSync(new URL('../rules/fsanz-energy-statement.json', import.meta.url), 'utf8'),
);
const file = 'rules/fsanz-energy-statement.json';

/** A follow-up version of the current rules file, as a PR would produce it. */
function nextVersion(change) {
  const next = structuredClone(current);
  next.version = '0.2.0';
  next.versions.push({ version: '0.2.0', date: '2026-10-01', notes: 'test' });
  change?.(next);
  return next;
}

test('a new rules file passes (the schema check covers it)', () => {
  assert.deepEqual(checkRulesChange(null, current, file), []);
});

test('a changed rule with a new verified_at and a version bump passes', () => {
  const after = nextVersion((next) => {
    next.rules.min_abv_percent.notes = 'Re-read against the February 2026 guidance.';
    next.rules.min_abv_percent.verified_at = '2026-10-01';
  });
  assert.deepEqual(checkRulesChange(current, after, file), []);
});

test('a changed rule without a new verified_at fails', () => {
  const after = nextVersion((next) => {
    next.rules.min_abv_percent.value = 0.6;
  });
  assert.match(checkRulesChange(current, after, file).join('\n'), /min_abv_percent/);
});

test('any change without a version bump fails', () => {
  const after = structuredClone(current);
  after.sources.fsanz_p1059.notes = 'moved';
  assert.match(checkRulesChange(current, after, file).join('\n'), /bump "version"/);
});

test('deleting a rules file fails', () => {
  assert.equal(checkRulesChange(current, null, file).length, 1);
});
