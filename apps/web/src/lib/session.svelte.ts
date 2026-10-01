// Who is signed in, for the header and the pages. Checked once on load and after sign-in/out.
import { api, type Account } from './account';

export const session = $state<{ account: Account | null; checked: boolean }>({
  account: null,
  checked: false,
});

export async function refreshSession(): Promise<Account | null> {
  try {
    const res = await api<{ account: Account | null }>('auth/me');
    session.account = res.ok ? res.data.account : null;
  } catch {
    session.account = null;
  } finally {
    session.checked = true;
  }
  return session.account;
}

/**
 * After Stripe Checkout: Stripe tells the server by webhook, which can trail the redirect by a
 * few seconds. Checks the account until `ready` holds, for up to `tries` × `everyMs`.
 */
export async function waitForAccount(
  ready: (account: Account) => boolean,
  tries = 15,
  everyMs = 2000,
): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const account = await refreshSession();
    if (account && ready(account)) return true;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
  return false;
}
