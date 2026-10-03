import { defineConfig } from '@playwright/test';

const port = 5174; // so it can run next to `./dev up`

// Set by `./dev e2e` when `./dev up` is running: the tests use the dev server
// (and its dev league) instead of booting a production build of their own.
const devServer = !!process.env.E2E_DEV;

export default defineConfig({
  testDir: '.',
  // every test resets the same league so they run one at a time
  workers: 1,
  forbidOnly: !!process.env.CI,
  outputDir: 'results',
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'report' }]]
    : 'list',
  use: {
    baseURL: `http://localhost:${devServer ? 5173 : port}`,
    browserName: 'chromium',
    viewport: { width: 800, height: 900 },
    isMobile: true,
    trace: 'retain-on-failure',
  },
  // the production build, with in memory storage (see vite.config.ts).
  // `./dev e2e` runs the build itself (E2E_BUILT) so its output is visible
  webServer: devServer
    ? undefined
    : {
        command: process.env.E2E_BUILT
          ? `vite preview --port ${port} --strictPort`
          : `vite build && vite preview --port ${port} --strictPort`,
        cwd: '..',
        env: { E2E: '1' },
        url: `http://localhost:${port}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
