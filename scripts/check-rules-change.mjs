#!/usr/bin/env node
// On a pull request, a change to any rules/*.json file must bump the rules version, describe it
// in versions[], and set a new verified_at on every rule it changes (Build Brief 01, section 11).
//   node scripts/check-rules-change.mjs <base-ref>      e.g. origin/main
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const withoutVerifiedAt = (rule) => {
  if (!rule) return null;
  const { verified_at: _ignored, ...rest } = rule;
  return JSON.stringify(rest);
};

/** Problems with a change from `before` to `after` (either may be null: added or removed file). */
export function checkRulesChange(before, after, file) {
  if (after === null)
    return [`${file}: deleting a rules file needs a decision recorded in the brief, not a PR`];
  if (before === null) return []; // new file: the schema check covers it
  const problems = [];
  if (after.version === before.version) {
    problems.push(`${file}: bump "version" (still ${after.version})`);
  }
  if (!after.versions?.some((v) => v.version === after.version)) {
    problems.push(`${file}: add a versions[] entry for ${after.version}`);
  }
  for (const [key, rule] of Object.entries(after.rules ?? {})) {
    const previous = before.rules?.[key];
    if (withoutVerifiedAt(rule) === withoutVerifiedAt(previous)) continue;
    if (rule.verified_at === null || rule.verified_at === previous?.verified_at) {
      problems.push(
        `${file}: rule "${key}" changed; verify it against its sources and update verified_at`,
      );
    }
  }
  return problems;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const base = process.argv[2];
  if (!base) {
    console.error('usage: check-rules-change.mjs <base-ref>');
    process.exit(2);
  }
  const files = git(['diff', '--name-only', `${base}...HEAD`, '--', 'rules/'])
    .split('\n')
    .filter((file) => file.endsWith('.json'));
  const problems = files.flatMap((file) => {
    let before = null;
    try {
      before = JSON.parse(git(['show', `${base}:${file}`]));
    } catch {
      // not present on the base branch
    }
    const after = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    return checkRulesChange(before, after, file);
  });
  if (problems.length > 0) {
    console.error('Rules change check failed:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log(
    files.length === 0 ? 'No rules files changed.' : `Rules changes OK: ${files.join(', ')}`,
  );
}
