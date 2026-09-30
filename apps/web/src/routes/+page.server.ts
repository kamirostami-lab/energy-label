// The generator is one prerendered page: the rules it needs are read here at build time, so the
// browser never loads the rules file or the renderer. Statement values come from /api/preview.
import { generatorConfig } from '@energy-panel/api/config';
import { loadFsanzEnergyStatementRules } from '@energy-panel/rules';
import type { PageServerLoad } from './$types';

export const prerender = true;

export const load: PageServerLoad = () => ({
  config: generatorConfig(loadFsanzEnergyStatementRules()),
});
