/** Actual app footage in disposable browser contexts, never the user's session. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = `https://${process.env.REPLIT_DEV_DOMAIN}/`;
const dir = resolve('generated-artifacts/devpost-video');
await mkdir(resolve(dir, 'captures'), { recursive: true });
const browser = await chromium.launch({ executablePath: '/repl/tools/bin/chromium' });
const simOnly = process.argv.includes('--simulation-only');
const records = simOnly ? JSON.parse(await readFile(resolve(dir, 'captures.json'), 'utf8')).records : {};
async function context() {
  return browser.newContext({
    viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce',
    recordVideo: { dir: resolve(dir, 'captures'), size: { width: 1280, height: 720 } },
  });
}
async function begin(ctx, id, path) {
  const page = await ctx.newPage(), began = Date.now();
  await page.goto(new URL(path, base).href);
  await page.evaluate(() => document.fonts.ready);
  const banner = page.getByRole('button', { name: 'Close banner', exact: true });
  if (await banner.isVisible()) await banner.click();
  await page.waitForTimeout(700);
  records[id] = { file: await page.video().path(), start: (Date.now() - began) / 1000 };
  return page;
}
try {
  if (!simOnly) {
  const home = await context();
  const hp = await begin(home, 'home', '');
  await hp.waitForTimeout(14000);
  await home.close();
  const monitor = await context();
  const mp = await begin(monitor, 'monitor', 'dashboard');
  await mp.waitForTimeout(6500);
  const response = await begin(monitor, 'responses', 'dashboard');
  await response.getByTestId('responses-panel').evaluate(el => {
    for (let p = el.parentElement; p; p = p.parentElement)
      if (p instanceof HTMLDetailsElement) p.open = true;
    el.scrollIntoView({ block: 'center' });
  });
  await response.waitForTimeout(8000);
  await monitor.close();
  }
  const sim = await context();
  const sp = await begin(sim, 'simulation', 'dashboard?source=simulation');
  await sp.getByTestId('button-scenario-sustained').waitFor();
  await sp.getByTestId('button-scenario-sustained').click();
  await sp.getByTestId('section-camera').evaluate(el => {
    window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 72);
  });
  await sp.waitForTimeout(9000);
  await sp.getByTestId('zone-workflow').scrollIntoViewIfNeeded();
  await sp.waitForTimeout(9000);
  await sp.close(); // Stop simulation; keep only its isolated local history.
  const ep = await begin(sim, 'review', 'events');
  await ep.getByTestId('button-filter-zone').click();
  const row = ep.locator('[data-testid^="row-event-"]').first();
  const id = (await row.getAttribute('data-testid')).slice('row-event-'.length);
  await row.locator('[data-testid^="button-expand-"]').click();
  await ep.getByTestId(`review-outcome-${id}`).scrollIntoViewIfNeeded();
  await ep.waitForTimeout(5000);
  await ep.getByTestId(`review-outcome-${id}`).selectOption('no-assistance-needed');
  await ep.getByTestId(`button-review-${id}`).click();
  await ep.waitForTimeout(6000);
  await sim.close();
  await writeFile(resolve(dir, 'captures.json'), JSON.stringify({
    recordedAt: new Date().toISOString(), cameraRequested: false, microphoneRequested: false,
    userSessionAccessed: false, responsesEnabled: false,
    description: 'Actual application pixels. Synthetic zone scenario only; review changes are isolated demo records.',
    records,
  }, null, 2));
  console.log('Captured actual homepage, monitor setup, response settings, simulation and human review.');
} finally { await browser.close(); }
