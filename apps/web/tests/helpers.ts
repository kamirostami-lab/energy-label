// What the browser tests share: signing in through the local outbox, axe-core, and the FSANZ
// guidance example entered in the generator.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const status = (page: Page) => page.getByRole('status').first();
export const uniqueEmail = () =>
  `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/** The newest sign-in link sent to `email` (the Worker runs with MAIL_TRANSPORT=outbox). */
export async function signInLink(page: Page, email: string): Promise<string> {
  let link: string | undefined;
  await expect(async () => {
    const res = await page.request.get(`/api/dev/outbox?to=${encodeURIComponent(email)}`);
    const { messages } = (await res.json()) as { messages: Array<{ text: string }> };
    link = /(http\S+#token=[\w-]+)/.exec(messages.at(-1)?.text ?? '')?.[1];
    expect(link).toBeTruthy();
  }).toPass();
  return link!;
}

/** Asks for a link on the sign-in page, follows it and finishes signing in. */
export async function signIn(page: Page, email: string) {
  if (!page.url().endsWith('/sign-in')) await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeFocused();
  const link = await signInLink(page, email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/sign-in\/confirm$/); // the token leaves the address bar
  await page.getByRole('button', { name: 'Finish signing in' }).click();
  // Signed in once the page moves on, to the SKU list or the generator.
  await expect(page).not.toHaveURL(/\/sign-in/);
}

export async function checkAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

/** The FSANZ guidance example: fortified wine, 21.1% ABV, 720 mL, 592 kJ per 100 mL. */
export async function enterFsanzExample(page: Page) {
  await page.getByRole('radio', { name: 'Fortified wine' }).check();
  await page.getByLabel('Alcohol by volume').fill('21.1');
  await page.getByLabel('Package volume').fill('720');
  await page.getByLabel('Average energy kJ per 100 mL').fill('592');
  await expect(status(page)).toHaveText('Ready to export.');
}
