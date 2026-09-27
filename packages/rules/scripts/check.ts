// Validates rules/fsanz-energy-statement.json and reports which rules still await verification.
// Usage: pnpm rules:check [--strict]   (--strict fails while any rule is unverified)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RulesValidationError, listUnverified, parseRules } from '../src/index.ts';

const strict = process.argv.includes('--strict');
const path = fileURLToPath(new URL('../../../rules/fsanz-energy-statement.json', import.meta.url));

try {
  const rules = parseRules(JSON.parse(readFileSync(path, 'utf8')));
  const total = Object.keys(rules.file.rules).length;
  const unverified = listUnverified(rules);
  console.log(`rules/fsanz-energy-statement.json  version ${rules.version}  ${total} rules  valid`);
  if (unverified.length === 0) {
    console.log('All rules verified.');
  } else {
    console.log(
      `${unverified.length} of ${total} rules have not been verified against their sources:`,
    );
    for (const key of unverified) console.log(`  - ${key}`);
    if (strict) {
      console.error('Strict mode: unverified rules block a release.');
      process.exit(1);
    }
  }
} catch (error) {
  if (error instanceof RulesValidationError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
