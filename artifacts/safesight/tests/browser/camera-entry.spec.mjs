import { test, expect } from '@playwright/test';

test('camera-first entry is idle until requested; denied permission has simulation recovery', async ({ page }) => {
  await page.addInitScript(() => {
    window.__cameraRequests = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async () => {
        window.__cameraRequests++;
        throw new DOMException('Camera permission denied', 'NotAllowedError');
      },
    });
  });
  const uploads = [];
  page.on('request', request => { if (request.method() === 'POST') uploads.push(request.url()); });
  await page.goto('./dashboard');
  await expect(page.getByTestId('text-health-phase')).toHaveText('Monitoring stopped');
  await expect(page.getByTestId('text-source-state')).toContainText('None');
  await expect(page.getByTestId('status-simulation')).toHaveCount(0);
  await expect(page.getByTestId('button-snapshot')).toBeDisabled();
  expect(await page.evaluate(() => window.__cameraRequests)).toBe(0);
  await page.getByTestId('button-start-camera-empty').click();
  await expect(page.getByTestId('status-error')).toContainText('Camera permission was not granted');
  await expect(page.getByTestId('text-source-state')).toContainText('Unavailable');
  expect(await page.evaluate(() => window.__cameraRequests)).toBe(1);
  await expect(page.getByTestId('button-snapshot')).toBeDisabled();
  await page.getByTestId('button-error-demo').click();
  await expect(page.getByTestId('status-simulation')).toBeVisible();
  await expect(page.getByTestId('text-health-phase')).toHaveText('Simulation / not live');
  await page.getByTestId('button-stop').click();
  await expect(page.getByTestId('text-health-phase')).toHaveText('Monitoring stopped');
  expect(uploads).toEqual([]);
});

test('homepage simulation action explicitly opens labeled scripted input', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('button-launch-demo').click();
  await expect(page).toHaveURL(/dashboard\?source=simulation/);
  await expect(page.getByTestId('status-simulation')).toBeVisible();
  await expect(page.getByTestId('button-scenario-sustained')).toBeVisible();
  await expect(page.getByTestId('button-snapshot')).toBeDisabled();
});

test('monitor starts simply and keeps options and technical evidence accessible', async ({ page }) => {
  await page.goto('./dashboard');
  await expect(page.getByRole('complementary', { name: 'Current observation' })).toBeHidden();
  await expect(page.getByTestId('button-start-camera-empty')).toBeVisible();
  await expect(page.getByTestId('button-switch-facing')).toBeHidden();
  const options = page.getByText('Camera options', { exact: true });
  await options.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('button-switch-facing')).toBeVisible();
  await page.getByTestId('button-switch-facing').click();
  await expect(page.getByTestId('button-start-camera-empty')).toContainText('rear');
  await page.getByTestId('button-start-demo-empty').click();
  await expect(page.getByTestId('section-observed')).toBeVisible();
  await expect(page.getByTestId('section-unknown')).toBeVisible();
  await expect(page.getByTestId('section-checks')).toBeVisible();
  const technical = page.getByTestId('observation-technical');
  await expect(technical).not.toHaveAttribute('open');
  await technical.locator('summary').first().click();
  await expect(page.getByTestId('text-risk-score')).toBeVisible();
  await expect(page.getByTestId('session-rule-history').locator('details').first()).not.toHaveAttribute('open');
});
