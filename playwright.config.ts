import { defineConfig } from '@playwright/test';

const softwareWebGL = process.platform === 'linux' || process.env.PLAYWRIGHT_SOFTWARE_WEBGL === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: process.env.CI ? 360_000 : 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  outputDir: 'test-results',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4183',
    // CI uses CPU rendering; compositor-backed clicks and captures can exceed 15s.
    actionTimeout: process.env.CI ? 60_000 : 15_000,
    navigationTimeout: 30_000,
    locale: 'en-US',
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    channel: 'chromium',
    launchOptions: { args: softwareWebGL
      ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-dev-shm-usage'] : [] },
  },
  projects: [
    { name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 960 } } },
    { name: 'chromium-touch', use: { browserName: 'chromium', viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'npm run preview -- --port 4183 --strictPort',
    url: 'http://127.0.0.1:4183',
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
  },
});
