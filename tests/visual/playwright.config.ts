import { defineConfig, devices } from '@playwright/test';

// Software-rendered WebGPU for Chromium (no GPU on CI); Firefox/WebKit use the WebGL2/2D fallback.
const webgpuArgs = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan,WebGPU',
  '--use-angle=swiftshader',
  '--use-webgpu-adapter=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

const common = {
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce' as const,
  colorScheme: 'dark' as const,
  locale: 'en-US',
  timezoneId: 'UTC',
};

export default defineConfig({
  testDir: './specs',
  // Baselines live in tests/visual/baselines/<project>/...
  snapshotPathTemplate: '{testDir}/../baselines/{projectName}/{testFilePath}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
  },
  webServer: {
    command: 'pnpm turbo run build --filter=@jurfi/samples && pnpm --filter @jurfi/samples preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...common, launchOptions: { args: webgpuArgs } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], ...common } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], ...common } },
  ],
});
