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
