import fsanzEnergyStatementJson from '../../../rules/fsanz-energy-statement.json' with { type: 'json' };
import { rulesFileSchema, type RuleKey, type RuleValues, type RulesFile } from './schema.ts';

export {
  EXEMPTION_CODES,
  JURISDICTIONS,
  TYPE_SIZE_MEASURES,
  rulesFileSchema,
  type ExemptionCode,
  type Jurisdiction,
  type RuleKey,
  type RuleValues,
  type RulesFile,
} from './schema.ts';

/** A rules file that has passed schema validation, with its values flattened for the renderer. */
export interface EnergyStatementRules {
  readonly id: RulesFile['rules_id'];
  readonly version: string;
  readonly jurisdictions: RulesFile['jurisdictions'];
  readonly values: RuleValues;
  readonly file: RulesFile;
}

export class RulesValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid rules file:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'RulesValidationError';
    this.issues = issues;
  }
}

/** Validates a parsed rules JSON document. Throws RulesValidationError when it does not conform. */
export function parseRules(json: unknown): EnergyStatementRules {
  const result = rulesFileSchema.safeParse(json);
  if (!result.success) {
    throw new RulesValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  const file = result.data;
  const values = Object.fromEntries(
    Object.entries(file.rules).map(([key, rule]) => [key, rule.value]),
  ) as RuleValues;
  return {
    id: file.rules_id,
    version: file.version,
    jurisdictions: file.jurisdictions,
    values,
    file,
  };
}

let bundled: EnergyStatementRules | undefined;

/** The rules file shipped with this build (rules/fsanz-energy-statement.json). */
export function loadFsanzEnergyStatementRules(): EnergyStatementRules {
  bundled ??= parseRules(fsanzEnergyStatementJson);
  return bundled;
}

/** Rule keys that no person has yet verified against their sources. */
export function listUnverified(rules: EnergyStatementRules): RuleKey[] {
  return (Object.keys(rules.file.rules) as RuleKey[]).filter(
    (key) => rules.file.rules[key].verified_at === null,
  );
}
