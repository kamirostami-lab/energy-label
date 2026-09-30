// Accounts in a real browser (Build Brief 01 sections 5, 6 and 8): magic-link sign-in through the
// local outbox, SKU records saved from the generator, the account's free export stored and
// listed with its rules version, the SKU list and its CSV, and axe-core on the new pages.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const status = (page: Page) => page.getByRole('status').first();
const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/** The newest sign-in link sent to `email` (the Worker runs with MAIL_TRANSPORT=outbox). */
async function signInLink(page: Page, email: string): Promise<string> {
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
async function signIn(page: Page, email: string) {
  if (!page.url().endsWith('/sign-in')) await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeFocused();
  const link = await signInLink(page, email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/sign-in\/confirm$/); // the token leaves the address bar
  await page.getByRole('button', { name: 'Finish signing in' }).click();
}

async function checkAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

/** The FSANZ guidance example: fortified wine, 21.1% ABV, 720 mL, 592 kJ per 100 mL. */
async function enterFsanzExample(page: Page) {
  await page.getByRole('radio', { name: 'Fortified wine' }).check();
  await page.getByLabel('Alcohol by volume').fill('21.1');
  await page.getByLabel('Package volume').fill('720');
  await page.getByLabel('Average energy kJ per 100 mL').fill('592');
  await expect(status(page)).toHaveText('Ready to export.');
}

test('signs in with an emailed link, saves a SKU, exports it and lists it', async ({ page }) => {
  await signIn(page, uniqueEmail());
  await expect(page).toHaveURL(/\/skus$/);
  await expect(page.getByText('No SKUs yet.')).toBeVisible();
  await checkAxe(page);

  await page.getByLabel('Organisation name').fill('Komms-Haus');
  await page.getByRole('button', { name: 'Save account details' }).click();
  await expect(page.getByText('Account details saved.')).toBeVisible();

  await page.getByRole('link', { name: 'New SKU' }).click();
  await expect(page.getByRole('status').first()).not.toHaveText('Checking…');
  await expect(page.getByLabel('Producer')).toHaveValue('Komms-Haus');
  await enterFsanzExample(page);
  await page.getByLabel('Product', { exact: true }).fill('Reserve Tawny');
  await page.getByLabel('Vintage or batch').fill('Batch 7');
  await page.getByRole('button', { name: 'Save SKU' }).click();
  await expect(page.getByText('Saved to your SKUs.')).toBeVisible();
  await expect(page).toHaveURL(/\/\?sku=[\w-]+$/);

  await page.getByLabel('Vintage or batch').fill('Batch 8');
  await expect(page.getByText('Unsaved changes.')).toBeVisible();

  // Exporting saves the change first, then records the export against the SKU.
  await page.getByRole('button', { name: 'Export free preview files' }).click();
  await expect(page.getByRole('heading', { name: 'Your preview files' })).toBeFocused();
  const links = page.locator('ul.files a');
  await expect(links).toHaveCount(4);
  const names = await links.allTextContents();
  const stem = /^\d{8}-komms-haus-reserve-tawny-energy-panel-50mm/;
  expect(names.map((name) => name.replace(stem, ''))).toEqual([
    '-preview.svg',
    '-preview.pdf',
    '-pdf14-preview.pdf',
    '-proof-preview.pdf',
  ]);
  const [download] = await Promise.all([page.waitForEvent('download'), links.nth(1).click()]);
  expect(download.suggestedFilename()).toBe(names[1]);
  const pdf = await readFile((await download.path())!);
  expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.6');

  await expect(page.getByText('Saved to your SKUs.')).toBeVisible();
  await expect(page.getByText('This account has used its free preview export.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export free preview files' })).toHaveCount(0);
  const history = page.locator('ol.history > li');
  await expect(history).toHaveCount(1);
  await expect(history.first()).toContainText(/rules \d+\.\d+\.\d+ ·\s+watermarked preview/);
  await checkAxe(page);

  await page.getByRole('link', { name: 'Your SKUs' }).first().click();
  const row = page.getByRole('row', { name: /Reserve Tawny/ });
  await expect(row).toContainText('Fortified wine');
  await expect(row).toContainText('Komms-Haus');
  await expect(row).toContainText('Batch 8');
  await expect(row).toContainText(/\d+\.\d+\.\d+/);
  await checkAxe(page);

  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download the list (CSV)' }).click(),
  ]);
  expect(csv.suggestedFilename()).toMatch(/^\d{8}-komms-haus-energy-panel-skus\.csv$/);
  const text = await readFile((await csv.path())!, 'utf8');
  expect(text.split('\r\n')[1]).toContain(
    ',Reserve Tawny,Komms-Haus,fortified_wine,Batch 8,21.1,720,60,',
  );

  const [record] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download the export record (CSV)' }).click(),
  ]);
  expect(record.suggestedFilename()).toMatch(/^\d{8}-komms-haus-energy-panel-exports\.csv$/);
  const rows = (await readFile((await record.path())!, 'utf8')).trim().split('\r\n');
  expect(rows).toHaveLength(2);
  expect(rows[1]).toMatch(/,true,Komms-Haus,Reserve Tawny,Batch 8,21\.1,720,60,.*,[0-9a-f]{64}$/);

  // Opening the SKU from the list brings its values and exports back.
  await row.getByRole('link', { name: 'Reserve Tawny' }).click();
  await expect(page.getByLabel('Alcohol by volume')).toHaveValue('21.1');
  await expect(page.getByLabel('Product', { exact: true })).toHaveValue('Reserve Tawny');
  await expect(page.getByLabel('Vintage or batch')).toHaveValue('Batch 8');
  await expect(status(page)).toHaveText('Ready to export.');
  await expect(page.locator('ol.history > li')).toHaveCount(1);
  await expect(page.getByText('Saved to your SKUs.')).toBeVisible();

  // The header's Generator link starts a new, empty SKU.
  await page.getByRole('link', { name: 'Generator' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel('Alcohol by volume')).toHaveValue('');
  await expect(page.getByLabel('Product', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Save SKU' })).toBeVisible();
});

test('keeps values entered before signing in, to save them as a SKU', async ({ page }) => {
  await page.goto('/');
  await expect(status(page)).not.toHaveText('Checking…');
  await enterFsanzExample(page);
  await page.getByLabel('Producer').fill('Château Lune');
  await page.getByLabel('Product', { exact: true }).fill('Tawny');
  await page.locator('section.export').getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await checkAxe(page);

  await signIn(page, uniqueEmail());
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByLabel('Alcohol by volume')).toHaveValue('21.1');
  await expect(page.getByLabel('Producer')).toHaveValue('Château Lune');
  await expect(page.getByLabel('Product', { exact: true })).toHaveValue('Tawny');
  await page.getByRole('button', { name: 'Save SKU' }).click();
  await expect(page.getByText('Saved to your SKUs.')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
  await expect(page.getByLabel('Product', { exact: true })).toHaveValue('');
});

test('uses each sign-in link once', async ({ page }) => {
  const email = uniqueEmail();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  const link = await signInLink(page, email);

  await page.goto(link);
  await checkAxe(page);
  await page.getByRole('button', { name: 'Finish signing in' }).click();
  await expect(page).toHaveURL(/\/skus$/);

  await page.goto(link);
  await page.getByRole('button', { name: 'Finish signing in' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'This sign-in link has expired or has already been used. Ask for a new one.',
  );
  await expect(page.getByRole('link', { name: 'Ask for a new sign-in link' })).toBeVisible();
});

test('asks for a valid email address', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByLabel('Email address')).toBeFocused();
  await expect(page.locator('#email-msg')).toHaveText('Enter your email address.');
  await page.getByLabel('Email address').fill('not-an-address');
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.locator('#email-msg')).toHaveText('Enter a valid email address.');
  await expect(page.getByLabel('Email address')).toHaveAttribute('aria-invalid', 'true');
});

test('asks visitors who are signed out to sign in for SKUs', async ({ page }) => {
  await page.goto('/skus');
  await expect(page.getByRole('link', { name: 'Sign in' }).last()).toBeVisible();
  await expect(page.getByText(/to see your SKUs/)).toBeVisible();
  await page.goto('/?sku=missing');
  await expect(page.getByRole('alert')).toContainText('Sign in to open this SKU.');
});
