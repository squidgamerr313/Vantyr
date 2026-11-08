import { test, expect } from '@playwright/test';

test('manual steps stay selected and walkthrough is opt-in with a useful static alternative', async ({ page }) => {
  const media = [];
  page.on('request', request => { if (/simulation-review\.mp4/.test(request.url())) media.push(request.url()); });
  await page.goto('./');
  await page.getByTestId('button-step-2').click();
  await expect(page.getByTestId('button-step-2')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(3900);
  await expect(page.getByTestId('button-step-2')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#walkthrough-transcript')).toContainText('Resolution is a separate');
  expect(media).toEqual([]);
  await page.getByTestId('button-load-walkthrough').click();
  const video = page.getByTestId('walkthrough-video');
  await expect(video).toHaveAttribute('preload', 'none');
  expect(await video.evaluate(v => v.paused)).toBe(true);
  expect(media).toEqual([]);
  await video.evaluate(v => v.play());
  await expect.poll(() => video.evaluate(v => v.currentTime)).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => video.evaluate(v => v.paused)).toBe(true);
});

test('simulation observation precedes secondary scores; settings expose actual save and on/off state', async ({ page }) => {
  await page.goto('./dashboard?source=simulation');
  await expect(page.getByTestId('status-simulation')).toBeVisible();
  await expect(page.getByTestId('button-snapshot')).toBeDisabled();
  await expect(page.getByTestId('monitor-diagnostics')).not.toHaveAttribute('open');
  const order = await page.evaluate(() => {
    const observation = document.querySelector('[data-testid="observation-assessment"]');
    const history = document.querySelector('[data-testid="session-rule-history"]');
    return !!(observation.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true);
  await page.getByTestId('button-stop').click();
  await expect(page.getByTestId('text-health-phase')).toHaveText('Monitoring stopped');
  await page.getByTestId('link-nav-settings').click();
  await page.getByTestId('switch-boxes').click();
  await expect(page.getByTestId('status-prefs-save')).toContainText('saved');
  await expect(page.getByTestId('switch-boxes')).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  await expect(page.getByTestId('switch-boxes')).toHaveAttribute('aria-checked', 'false');
});

test('failed video keeps the illustrated and text walkthrough useful', async ({ page }) => {
  await page.route('**/simulation-review.mp4', route => route.abort());
  await page.goto('./');
  await page.getByTestId('button-load-walkthrough').click();
  await page.getByTestId('walkthrough-video').evaluate(v => { void v.play().catch(() => {}); });
  await expect(page.getByTestId('product-walkthrough')).toContainText('Playback is unavailable.');
  await expect(page.getByRole('img', { name: /Illustrated simulation/ })).toBeVisible();
  await expect(page.locator('#walkthrough-transcript')).toContainText('Record a human check');
});

for (const size of [{width:320,height:740}, {width:844,height:390}, {width:768,height:1024}, {width:1440,height:900}]) {
  test(`routes fit ${size.width}x${size.height} without page overflow`, async ({ page }) => {
    await page.setViewportSize(size);
    for (const route of ['./', './dashboard', './events', './settings']) {
      await page.goto(route);
      await expect(page.locator('h1')).toBeVisible();
      const overflow = await page.evaluate(() => {
        // Inspect actual content, not just a clipped document scrollWidth.
        const w = document.documentElement.clientWidth;
        return [...document.querySelectorAll('main button, main input, main select, header a')]
          .filter(e => e.getClientRects().length)
          .filter(e => { const r = e.getBoundingClientRect(); return r.left < -1 || r.right > w + 1; })
          .map(e => e.getAttribute('data-testid') || e.textContent);
      });
      expect(overflow).toEqual([]);
    }
  });
}
