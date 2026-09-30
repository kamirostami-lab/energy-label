// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Env } from '@energy-panel/api';

declare global {
  namespace App {
    interface Platform {
      /** Worker bindings and variables: D1, R2 and the sign-in mail settings. */
      env: Env;
    }
  }
}

export {};
