import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  outputDir: '../../generated-artifacts/safesight-browser',
  reporter: 'list',
  workers: 1,
  use: {
    baseURL: process.env.SAFESIGHT_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`,
    reducedMotion: 'reduce',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
});
