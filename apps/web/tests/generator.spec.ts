// The generate flow in a real browser against the built Worker (Build Brief 01 sections 4 and 9):
// keyboard-only completion, validation states, the free preview export, and axe-core.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Presses Tab until the element matching `selector` has focus: proves it is reachable. */
async function tabTo(page: Page, selector: string, max = 80) {
  for (let i = 0; i < max; i++) {
    if (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`${selector} could not be reached with the Tab key`);
}

const preview = (page: Page) => page.locator('figure.stage img');
const status = (page: Page) => page.getByRole('status');

/** The FSANZ guidance example (12 servings of 60 mL, 592 kJ per 100 mL), by keyboard. */
async function enterFsanzExample(page: Page) {
  await page.goto('/');
  await tabTo(page, 'input[name="beverage"]:checked');
  await page.keyboard.press('ArrowRight'); // Wine → Fortified wine: 60 mL serving, "bottle"
  await tabTo(page, '#abv');
  await page.keyboard.type('21.1');
  await tabTo(page, '#package-ml');
  await page.keyboard.type('720');
  await tabTo(page, '#kj');
  await page.keyboard.type('592');
}

test('completes the generate flow with the keyboard only', async ({ page }) => {
  await enterFsanzExample(page);
  await expect(preview(page)).toHaveAttribute('alt', /Servings per bottle: 12\./);
  await expect(preview(page)).toHaveAttribute(
    'alt',
    /Serving size: 60 mL \(1 standard drink\)\. .*Average quantity per serving: 355 kJ\./,
  );
  await expect(status(page)).toHaveText('Ready to export.');
  await expect(page.getByText('Standard drinks in the package: 12.0.')).toBeVisible();

  await tabTo(page, '#producer');
  await page.keyboard.type('Komms-Haus');
  await tabTo(page, '#sku');
  await page.keyboard.type('FSANZ example');
  await tabTo(page, 'button.primary');
  await page.keyboard.press('Enter');

  const heading = page.getByRole('heading', { name: 'Your preview files' });
  await expect(heading).toBeFocused();
  const links = page.locator('ul.files a');
  await expect(links).toHaveCount(4);
  const names = await links.allTextContents();
  const stem = /^\d{8}-komms-haus-fsanz-example-energy-panel-50mm/;
  expect(names.every((name) => stem.test(name))).toBe(true);
  expect(names.map((name) => name.replace(stem, ''))).toEqual([
    '-preview.svg',
    '-preview.pdf',
    '-pdf14-preview.pdf',
    '-proof-preview.pdf',
  ]);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await tabTo(page, 'ul.files a');
      await page.keyboard.press('Enter');
    })(),
  ]);
  expect(download.suggestedFilename()).toMatch(/-preview\.svg$/);
});

test('blocks export below 0.5% ABV until the beverage type is confirmed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Beer' }).check();
  await page.getByLabel('Alcohol by volume').fill('0.4');
  await page.getByLabel('Package volume').fill('375');
  await page.getByLabel('Average energy kJ per 100 mL').fill('90');
  await expect(status(page)).toHaveText('1 item to resolve before export.');
  await expect(page.getByText('Is this a standardised alcoholic beverage?')).toBeVisible();

  await page.getByRole('radio', { name: 'Yes' }).check();
  await expect(status(page)).toHaveText('Ready to export.');
  await expect(preview(page)).toHaveAttribute('alt', /Servings per can: 1\./);
});

test('shows field messages once a field has been left, and warnings do not block', async ({
  page,
}) => {
  await page.goto('/');
  const abv = page.getByLabel('Alcohol by volume');
  await expect(abv).not.toHaveAttribute('aria-invalid', 'true');
  await abv.fill('abc');
  await abv.blur();
  await expect(abv).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#abv-msg')).toContainText('Enter the alcohol content');

  await abv.fill('13.5');
  await page.getByLabel('Package volume').fill('750');
  await page.getByLabel('Average energy kJ per 100 mL').fill('316');
  await page.getByLabel('The label displays a nutrition information panel').check();
  await expect(status(page)).toHaveText('Ready to export.');
  await expect(page.locator('.checks')).toContainText('nutrition information panel');
});

test('allows one free preview export per browser', async ({ page }) => {
  await enterFsanzExample(page);
  await page.getByLabel('Producer').fill('Komms-Haus');
  await page.getByLabel('Product', { exact: true }).fill('FSANZ example');
  await page.getByRole('button', { name: 'Export free preview files' }).click();
  await expect(page.locator('ul.files a')).toHaveCount(4);

  await page.reload();
  await expect(page.getByText('This browser has used its free preview export.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export free preview files' })).toHaveCount(0);
});

test('exports the values on screen even when clicked straight after typing', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Producer').fill('Komms-Haus');
  await page.getByLabel('Product', { exact: true }).fill('Quick');
  await page.getByLabel('Alcohol by volume').fill('13.5');
  await page.getByLabel('Package volume').fill('750');
  // The last value goes in and the button is pressed before the preview has caught up.
  await page.getByLabel('Average energy kJ per 100 mL').fill('316');
  await page.getByRole('button', { name: 'Export free preview files' }).click();
  await expect(page.locator('ul.files a')).toHaveCount(4);
});

test('refuses a blocked statement at export and points to the checks', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Producer').fill('Komms-Haus');
  await page.getByLabel('Product', { exact: true }).fill('Blocked');
  await page.getByLabel('Alcohol by volume').fill('13.5');
  await page.getByLabel('Package volume').fill('750');
  await page.getByRole('button', { name: 'Export free preview files' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Resolve the items listed under Checks before exporting.',
  );
  await expect(page.getByRole('heading', { name: 'Checks' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Export free preview files' })).toBeVisible();
});

test('asks for the producer and product before exporting', async ({ page }) => {
  await enterFsanzExample(page);
  await page.getByRole('button', { name: 'Export free preview files' }).click();
  await expect(page.getByLabel('Producer')).toBeFocused();
  await expect(page.locator('#producer-msg')).toHaveText('Enter the producer name.');
});

test('has no serious or critical accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(status(page)).not.toHaveText('Checking…');
  const check = async () => {
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  };
  await check();

  // With a preview, findings, field errors and the below-threshold question showing.
  await page.getByLabel('Alcohol by volume').fill('0.3');
  await page.getByLabel('Alcohol by volume').blur();
  await page.getByLabel('Package volume').fill('330');
  await page.getByLabel('Average energy kJ per 100 mL').fill('80');
  await page.getByRole('radio', { name: 'White on transparent' }).check();
  await expect(preview(page)).toBeVisible();
  await check();
});
