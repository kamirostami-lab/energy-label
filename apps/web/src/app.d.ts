// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    interface Platform {
      /** Worker bindings. None yet: D1, R2 and KV arrive in session 4. */
      env: Record<string, never>;
    }
  }
}

export {};
