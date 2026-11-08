import { test, expect } from '@playwright/test';

const PREF = 'safesight.prefs.v1';
const answer = {
  answer: 'Hide the pose overlay to simplify the display. This does not turn off posture processing.',
  sources: ['display-config'],
  proposal: { reason: 'Display-only change; detections and scoring continue.', changes: { showPose: false } },
};
const pose = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}').showPose, PREF);
async function openAssistant(page) {
  if (!(await page.getByTestId('dialog-setup-assistant').isVisible())) {
    await page.getByTestId('button-assistant-launcher').click();
  }
}
async function suggest(page) {
  await openAssistant(page);
  await page.getByTestId('input-chat').fill('Hide the pose overlay.');
  await page.getByTestId('button-chat-send').click();
  await expect(page.getByTestId('card-proposal')).toBeVisible();
}
test('docs search, configuration keys, empty-state recovery and direct article links', async ({ page }) => {
  await page.goto('./docs#zones');
  await expect(page.getByTestId('article-zones')).toBeVisible();
  await expect(page.getByTestId('text-privacy-notice')).toContainText('No video');
  await page.getByTestId('input-docs-search').fill('maxEvents');
  await expect(page.getByTestId('article-logging-config')).toBeVisible();
  await expect(page.getByTestId('status-docs-results')).toContainText('1 of');
  await page.getByTestId('input-docs-search').fill('nonexistent-configuration-12345');
  await expect(page.getByTestId('state-docs-empty')).toBeVisible();
  await page.getByTestId('button-docs-reset').click();
  await expect(page.getByTestId('article-getting-started')).toBeVisible();
});
test('AI proposals require Apply, preserve private data and support undo across Settings', async ({ page }) => {
  let body;
  await page.route('**/api/setup/chat', async route => {
    body = route.request().postDataJSON();
    await route.fulfill({ json: answer });
  });
  await page.goto('./docs');
  await page.evaluate(() => localStorage.setItem('safesight.events.v1', '[]'));
  await suggest(page);
  expect(body.settings).not.toHaveProperty('maxEvents');
  expect(Object.keys(body)).toEqual(['messages', 'settings']);
  expect(await pose(page)).not.toBe(false);
  await expect(page.getByTestId('diff-showPose')).toContainText('On');
  await expect(page.getByTestId('diff-showPose')).toContainText('Off');
  await page.getByTestId('button-proposal-apply').click();
  expect(await pose(page)).toBe(false);
  await page.getByTestId('button-chat-undo').click();
  expect(await pose(page)).toBe(true);
  await page.getByTestId('link-nav-settings').click();
  await expect(page.getByTestId('switch-pose')).toHaveAttribute('aria-checked', 'true');
});
test('newer preference edits block both stale apply and stale undo', async ({ page }) => {
  await page.route('**/api/setup/chat', route => route.fulfill({ json: answer }));
  await page.goto('./docs');
  await suggest(page);
  await page.evaluate(key => {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    localStorage.setItem(key, JSON.stringify({ ...value, showPose: false }));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  }, PREF);
  await page.getByTestId('button-proposal-apply').click();
  await expect(page.getByTestId('status-chat')).toContainText('changed after');
  expect(await pose(page)).toBe(false);
  await page.evaluate(key => {
    localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key)), showPose: true }));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  }, PREF);
  await suggest(page);
  await page.getByTestId('button-proposal-apply').click();
  await page.evaluate(key => {
    localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key)), showPose: true }));
    window.dispatchEvent(new StorageEvent('storage', { key }));
  }, PREF);
  await page.getByTestId('button-chat-undo').click();
  await expect(page.getByTestId('status-chat')).toContainText('edited again');
  expect(await pose(page)).toBe(true);
});
test('dismiss, provider errors and blocked storage never claim a successful save', async ({ page }) => {
  await page.route('**/api/setup/chat', route => route.fulfill({ json: answer }));
  await page.goto('./docs');
  await suggest(page);
  await page.getByTestId('button-proposal-dismiss').click();
  expect(await pose(page)).not.toBe(false);
  await suggest(page);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('blocked'); }; });
  await page.getByTestId('button-proposal-apply').click();
  await expect(page.getByTestId('status-chat')).toContainText('Not saved');
  expect(await pose(page)).not.toBe(false);
  await page.unroute('**/api/setup/chat');
  await page.route('**/api/setup/chat', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await page.getByTestId('input-chat').fill('Explain camera setup.');
  await page.getByTestId('button-chat-send').click();
  await expect(page.getByTestId('text-chat-error')).toContainText('Nothing changed');
  await expect(page.getByTestId('button-chat-retry')).toBeVisible();
});
test('citations reveal a filtered article and clear cancels late proposals', async ({ page }) => {
  await page.route('**/api/setup/chat', route => route.fulfill({ json: answer }));
  await page.goto('./docs');
  await page.getByTestId('input-docs-search').fill('camera permission');
  await suggest(page);
  await page.getByTestId('link-cite-display-config').click();
  await expect(page.getByTestId('article-display-config')).toBeVisible();
  await expect(page.getByTestId('input-docs-search')).toHaveValue('');
  await page.unroute('**/api/setup/chat');
  await page.route('**/api/setup/chat', async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({ json: answer }).catch(() => {});
  });
  await openAssistant(page);
  await page.getByTestId('input-chat').fill('Hide the overlay again.');
  await page.getByTestId('button-chat-send').click();
  await page.getByTestId('button-chat-clear').click();
  await page.waitForTimeout(700);
  await expect(page.getByTestId('card-proposal')).toHaveCount(0);
  await expect(page.getByTestId('log-chat')).toHaveCount(0);
});
test('popup close preserves drafts and proposals without applying or clearing', async ({ page }) => {
  await page.route('**/api/setup/chat', route => route.fulfill({ json: answer }));
  await page.goto('./docs');
  await expect(page.getByTestId('dialog-setup-assistant')).toBeHidden();
  await suggest(page);
  await page.getByTestId('input-chat').fill('Keep this unsent question');
  await page.getByTestId('button-close-assistant').click();
  await expect(page.getByTestId('dialog-setup-assistant')).toBeHidden();
  await expect(page.getByTestId('button-assistant-launcher')).toBeFocused();
  expect(await pose(page)).not.toBe(false);
  await openAssistant(page);
  await expect(page.getByTestId('card-proposal')).toBeVisible();
  await expect(page.getByTestId('input-chat')).toHaveValue('Keep this unsent question');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dialog-setup-assistant')).toBeHidden();
  await openAssistant(page);
  await expect(page.getByTestId('card-proposal')).toBeVisible();
});
for (const width of [320, 390, 768, 1440]) {
  test(`docs and navigation fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./docs');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const overflow = await page.locator('main button, main input, main textarea, header a').evaluateAll(nodes =>
      nodes.filter(n => n.getClientRects().length).filter(n => {
        const r = n.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1;
      }).map(n => n.getAttribute('data-testid') || n.textContent));
    expect(overflow).toEqual([]);
  });
}
