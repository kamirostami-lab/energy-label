// Every /api request goes to the Hono app in apps/api, inside this Worker.
import { createApi } from '@energy-panel/api';
import type { RequestHandler } from './$types';

const api = createApi();

export const fallback: RequestHandler = ({ request, platform }) =>
  api.fetch(request, platform?.env);
