import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const test = base.extend<{ appErrors: string[] }>({
  appErrors: [async ({ page, context }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('[browser exception]', error.message); });
    page.on('console', message => {
      if (message.type() === 'error') { errors.push(message.text()); console.error('[browser error]', message.text()); }
    });
    // The game itself is local. Fonts must not make CI depend on third-party network access.
    await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    await context.addInitScript(() => {
      try { if (!localStorage.getItem('aeroflow-language')) localStorage.setItem('aeroflow-language', 'en'); } catch { /* Storage fallback is tested separately. */ }
    });
    await use(errors);
    expect(errors, 'no JavaScript errors or WebGL shader compilation errors').toEqual([]);
  }, { auto: true }],
});

const canvas = (page: Page) => page.locator('canvas[data-flight-core="rust-wasm"]');
async function ready(page: Page) {
  await expect(canvas(page)).toHaveAttribute('data-preloaded-maps', 'valley,factory,harbor,desert,downtown,mountains', { timeout: 100_000 });
  await expect(canvas(page)).toHaveAttribute('data-graphics-state', 'ready');
  await expect(page.locator('.scene-loading')).toHaveCount(0);
}
const number = async (page: Page, id: string) => Number(await page.getByTestId(id).textContent());
const preferenceKey = 'aeroflow:preferences';

test('all six maps render, day/night switches, hangar opens, and keyboard flight pauses and resumes', async ({ page }, info) => {
  await page.goto('/'); await ready(page);
  await expect(page).toHaveTitle('AEROFLOW — FPV drone playground');
  for (const [id, name] of [['valley', 'Pine Valley'], ['factory', 'Iron Works'], ['harbor', 'Sea Port'],
    ['desert', 'Red Dune Desert'], ['downtown', 'City Centre'], ['mountains', 'Alpine Ridges']]) {
    await page.getByLabel(`Switch to ${name}`, { exact: true }).click();
    await expect(canvas(page)).toHaveAttribute('data-map-id', id);
    await page.getByLabel('Switch to night', { exact: true }).click();
    await expect(page.getByLabel('Switch to day', { exact: true })).toBeVisible();
    await page.getByLabel('Switch to day', { exact: true }).click();
  }
  await info.attach('alpine-day', { body: await canvas(page).screenshot(), contentType: 'image/png' });
  await page.locator('.drone-hangar-toggle').click();
  const hangar = page.getByRole('dialog');
  await expect(hangar).toBeVisible();
  await expect(hangar.locator('canvas')).toBeVisible();
  await hangar.getByRole('button', { name: 'Close hangar', exact: true }).click();
  await expect(hangar).toHaveCount(0);
  await page.getByRole('button', { name: 'Free flight', exact: true }).click();
  await page.getByRole('button', { name: 'Start flight', exact: true }).click();
  const startAltitude = await number(page, 'altitude');
  await page.keyboard.down('Space');
  try { await expect.poll(() => number(page, 'altitude')).toBeGreaterThan(startAltitude + 3); }
  finally { await page.keyboard.up('Space'); }
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-panel')).toBeVisible();
  await page.locator('.pause-panel').getByRole('button', { name: 'Resume flight', exact: true }).click();
  await expect(page.locator('.pause-panel')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('.pause-panel').getByRole('button', { name: 'Return to start', exact: true }).click();
  await expect(page.getByTestId('timer')).toHaveText('00:00.00');
});

test('preferences survive a reload, quality really applies, build identity agrees, and reset retains personal records', async ({ page, context, request }, info) => {
  await context.addInitScript(() => {
    const Original = window.AudioContext;
    Object.defineProperty(window, '__audioContextsCreated', { value: 0, writable: true });
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        const owner = window as unknown as { __audioContextsCreated: number };
        owner.__audioContextsCreated++;
      }
    };
  });
  await page.goto('/'); await ready(page);
  await page.getByLabel('Switch to City Centre', { exact: true }).click();
  await page.getByRole('button', { name: 'Free flight', exact: true }).click();
  await page.getByLabel('Switch to night', { exact: true }).click();
  await page.locator('.view-toggle').click();
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Flight preferences', exact: true });
  const version = await (await request.get('/version.json')).json();
  await expect(settings.getByTestId('build-info')).toContainText(version.buildId);
  expect(version.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  await settings.getByRole('combobox', { name: 'Graphics quality', exact: true }).selectOption('low');
  await settings.getByLabel('Control sensitivity', { exact: true }).press('End');
  await settings.getByLabel('Hold-to-accelerate time', { exact: true }).press('Home');
  await settings.getByLabel('Reverse vertical dragging', { exact: true }).check();
  await settings.getByLabel('Game sound', { exact: true }).check();
  await settings.getByRole('button', { name: 'Apply settings', exact: true }).click();
  await ready(page);
  await expect(canvas(page)).toHaveAttribute('data-quality-preset', 'low');
  const budget = JSON.parse((await canvas(page).getAttribute('data-graphics-budget'))!);
  expect(budget.panoramaResolution).toBe(3548); expect(budget.shadowMapSize).toBe(0);
  await page.getByLabel('Switch to Alpine Ridges', { exact: true }).click();
  await expect(canvas(page)).toHaveAttribute('data-map-id', 'mountains');
  await info.attach('alpine-low-quality', { body: await canvas(page).screenshot(), contentType: 'image/png' });
  await page.getByLabel('Switch to City Centre', { exact: true }).click();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), preferenceKey);
  expect(saved).toMatchObject({ version: 1, mapId: 'downtown', mode: 'free', night: true, cameraMode: 'bomb',
    sound: true, qualityPreset: 'low', touch: { sensitivity: 2, accelerationMs: 500, invertVertical: true } });
  for (const transient of ['position', 'ammo', 'elapsed', 'checkpoint']) expect(saved).not.toHaveProperty(transient);
  await page.reload(); await ready(page);
  await expect(canvas(page)).toHaveAttribute('data-map-id', 'downtown');
  await expect(canvas(page)).toHaveAttribute('data-quality-preset', 'low');
  await expect(page.getByLabel('Switch to day', { exact: true })).toBeVisible();
  await expect(page.getByTestId('timer')).toHaveText('00:00.00');
  expect(await page.evaluate(() => (window as unknown as { __audioContextsCreated: number }).__audioContextsCreated)).toBe(0);
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(settings.getByLabel('Control sensitivity', { exact: true })).toHaveValue('2');
  await expect(settings.getByLabel('Hold-to-accelerate time', { exact: true })).toHaveValue('500');
  await expect(settings.getByLabel('Reverse vertical dragging', { exact: true })).toBeChecked();
  await info.attach('preferences', { body: await page.screenshot(), contentType: 'image/png' });
  await page.evaluate(() => localStorage.setItem('aeroflow:v5:best:valley:freestyle:assisted:calm', '42'));
  await settings.getByRole('button', { name: 'Reset all preferences', exact: true }).click();
  await ready(page);
  await expect(canvas(page)).toHaveAttribute('data-map-id', 'valley');
  await expect(canvas(page)).toHaveAttribute('data-quality-preset', 'auto');
  expect(await page.evaluate(() => localStorage.getItem('aeroflow:v5:best:valley:freestyle:assisted:calm'))).toBe('42');
});

test('graphics context loss retains the flight and recovers without automatically resuming', async ({ page }) => {
  await page.goto('/'); await ready(page);
  await page.getByRole('button', { name: 'Free flight', exact: true }).click();
  await page.getByRole('button', { name: 'Start flight', exact: true }).click();
  await expect(page.getByTestId('timer')).not.toHaveText('00:00.00');
  const extension = await canvas(page).evaluateHandle(element => {
    const gl = (element as HTMLCanvasElement).getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('This browser must expose WEBGL_lose_context for the recovery test');
    return extension;
  });
  await extension.evaluate(value => value.loseContext());
  await expect(canvas(page)).toHaveAttribute('data-graphics-state', 'lost');
  const pausedTime = await page.getByTestId('timer').textContent();
  await extension.evaluate(value => value.restoreContext());
  await expect(canvas(page)).toHaveAttribute('data-graphics-state', 'ready', { timeout: 60_000 });
  await expect(page.locator('.pause-panel')).toBeVisible();
  await expect(page.getByTestId('timer')).toHaveText(pausedTime!);
  await page.locator('.pause-panel').getByRole('button', { name: 'Resume flight', exact: true }).click();
  await expect(page.locator('.pause-panel')).toHaveCount(0);
  await extension.dispose();
});

test('all graphics presets render alpine shaders after rebuilding the six-map cache', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium-desktop', 'Desktop covers the explicit high-memory override');
  await page.goto('/'); await ready(page);
  await page.getByLabel('Switch to Alpine Ridges', { exact: true }).click();
  for (const preset of ['low', 'medium', 'high']) {
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Flight preferences', exact: true });
    await settings.getByRole('combobox', { name: 'Graphics quality', exact: true }).selectOption(preset);
    await settings.getByRole('button', { name: 'Apply settings', exact: true }).click();
    await expect(canvas(page)).toHaveAttribute('data-quality-preset', preset);
    await ready(page);
    await expect(canvas(page)).toHaveAttribute('data-map-id', 'mountains');
    const budget = JSON.parse((await canvas(page).getAttribute('data-graphics-budget'))!);
    expect(budget.alpineDetail).toBe(preset);
    await info.attach(`alpine-${preset}`, { body: await canvas(page).screenshot(), contentType: 'image/png' });
  }
});

test('malformed or unavailable preference storage never prevents map preparation', async ({ page, context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('aeroflow:preferences', '{broken');
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'aeroflow:preferences') throw new DOMException('Storage is disabled', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/'); await ready(page);
  await expect(canvas(page)).toHaveAttribute('data-map-id', 'valley');
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('This browser cannot save settings.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('landscape touch devices keep the mobile texture budget and gestures release their axes', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'chromium-touch', 'Requires a coarse primary pointer and real touch events');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/'); await ready(page);
  const budget = JSON.parse((await canvas(page).getAttribute('data-graphics-budget'))!);
  expect(budget.panoramaResolution).toBe(3548);
  expect(budget.maxPixelRatio).toBeLessThanOrEqual(1.25);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Free flight', exact: true }).click();
  await page.getByRole('button', { name: 'Start flight', exact: true }).click();
  const controls = page.locator('.touch-gesture-controls');
  await expect(controls).toBeVisible();
  const bounds = (await controls.boundingBox())!;
  const point = { x: bounds.x + bounds.width * 0.35, y: bounds.y + bounds.height * 0.58, id: 1 };
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  try {
    await expect(page.locator('.touch-gesture-flight')).toHaveCount(1);
    await expect.poll(() => number(page, 'speed'), { timeout: 20_000 }).toBeGreaterThan(20);
  } finally { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  await expect(page.locator('.touch-gesture-flight')).toHaveCount(0);
  await expect.poll(() => number(page, 'speed'), { timeout: 20_000 }).toBeLessThan(15);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await info.attach('touch-flight', { body: await page.screenshot(), contentType: 'image/png' });
  await cdp.detach();
});
