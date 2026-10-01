// Payments in a real browser against the Stripe stand-in (the Worker runs with
// STRIPE_TRANSPORT=fake): one export bought from the generator, the Producer plan bought on the
// plans page, the billing portal, and axe-core on the plans page (Build Brief 01 sections 3 and 8).
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { checkAxe, enterFsanzExample, signIn, uniqueEmail } from './helpers';

const nav = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true });

/** Signs in, names the organisation, and opens a new SKU in the generator. */
async function producerAtGenerator(page: Page) {
  await signIn(page, uniqueEmail());
  await page.getByLabel('Organisation name').fill('Komms-Haus');
  await page.getByRole('button', { name: 'Save account details' }).click();
  await expect(page.getByText('Account details saved.')).toBeVisible();
  await page.getByRole('link', { name: 'New SKU' }).click();
  await enterFsanzExample(page);
}

test('buys one export from the generator and exports print-ready files', async ({ page }) => {
  await producerAtGenerator(page);
  await page.getByLabel('Product', { exact: true }).fill('Reserve Tawny');
  await page.getByRole('button', { name: 'Buy this export: A$12' }).click();

  // The stand-in for Stripe Checkout.
  await expect(page.getByRole('heading', { name: 'Test checkout' })).toBeVisible();
  await expect(page.getByText('One print-ready export: A$12.00, GST included.')).toBeVisible();
  await page.getByRole('button', { name: 'Pay A$12.00 (test)' }).click();

  await expect(page).toHaveURL(/\/\?sku=[\w-]+$/);
  await expect(
    page.getByText('Payment confirmed: export the print-ready files below.'),
  ).toBeVisible();
  const exportButton = page.getByRole('button', { name: 'Export print-ready files' });
  await expect(exportButton).toBeFocused();
  await expect(page.getByText('1 print-ready export to use.')).toBeVisible();
  await expect(page.getByLabel('Product', { exact: true })).toHaveValue('Reserve Tawny');

  await exportButton.click();
  await expect(page.getByRole('heading', { name: 'Your print-ready files' })).toBeFocused();
  const links = page.locator('ul.files a');
  const names = await links.allTextContents();
  expect(
    names.map((name) => name.replace(/^\d{8}-komms-haus-reserve-tawny-energy-panel-50mm/, '')),
  ).toEqual(['.svg', '.pdf', '-pdf14.pdf', '-proof.pdf']);
  const [download] = await Promise.all([page.waitForEvent('download'), links.nth(1).click()]);
  expect(download.suggestedFilename()).toBe(names[1]);
  const pdf = await readFile((await download.path())!);
  expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.6');

  await expect(page.locator('ol.history > li').first()).toContainText('print-ready, bought export');
  // The bought export is used: the next one is bought again.
  await expect(page.getByRole('button', { name: 'Buy this export: A$12' })).toBeVisible();
  await checkAxe(page);
});

test('charges nothing when checkout is cancelled', async ({ page }) => {
  await producerAtGenerator(page);
  await page.getByLabel('Product', { exact: true }).fill('Cancelled');
  await page.getByRole('button', { name: 'Buy this export: A$12' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/\?sku=[\w-]+$/);
  await expect(page.getByText('Checkout was cancelled. Nothing was charged.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buy this export: A$12' })).toBeVisible();
});

test('subscribes on the plans page, exports without limit, and cancels in the portal', async ({
  page,
}) => {
  await signIn(page, uniqueEmail());
  await nav(page, 'Plans').click();
  await expect(page.getByRole('heading', { name: 'Plans and billing' })).toBeVisible();
  await expect(page.getByText('No plan.')).toBeVisible();
  await checkAxe(page);

  await page.getByRole('button', { name: 'Subscribe: A$24 a month' }).click();
  await expect(page.getByText('Producer plan: A$24.00 a month, GST included.')).toBeVisible();
  await page.getByRole('button', { name: 'Pay A$24.00 (test)' }).click();
  await expect(page).toHaveURL(/\/billing$/);
  await expect(page.getByText('Payment confirmed. Thank you.')).toBeVisible();
  await expect(page.getByText(/unlimited print-ready exports\. Renews on/)).toBeVisible();
  await expect(page.getByText('Your plan is active.')).toBeVisible();
  await checkAxe(page);

  await nav(page, 'Generator').click();
  await enterFsanzExample(page);
  await page.getByLabel('Producer').fill('Komms-Haus');
  await page.getByLabel('Product', { exact: true }).fill('On the plan');
  await expect(page.getByText('Producer plan: unlimited print-ready exports.')).toBeVisible();
  for (let i = 1; i <= 2; i++) {
    await page.getByRole('button', { name: 'Export print-ready files' }).click();
    await expect(page.locator('ol.history > li')).toHaveCount(i);
  }
  await expect(page.locator('ol.history > li').first()).toContainText('print-ready, on the plan');

  await nav(page, 'Plans').click();
  await page.getByRole('button', { name: 'Manage billing and invoices' }).click();
  await expect(page.getByRole('heading', { name: 'Test billing portal' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel now' }).click();
  await expect(page.getByText('Subscription: canceled.')).toBeVisible();
  await page.getByRole('link', { name: 'Return to Energy Panel' }).click();
  await expect(page).toHaveURL(/\/billing$/);
  await expect(page.getByText('No plan.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Subscribe: A$24 a month' })).toBeVisible();
});

test('shows visitors the plans, with a way to sign in', async ({ page }) => {
  await page.goto('/billing');
  await expect(page.getByRole('heading', { name: 'One print-ready export' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Producer plan' })).toBeVisible();
  await expect(page.locator('.price').nth(1)).toHaveText('A$24 a month GST included');
  await expect(page.getByRole('link', { name: 'Sign in to buy' })).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Printer plan' })).toHaveCount(0);
  await checkAxe(page);
});
