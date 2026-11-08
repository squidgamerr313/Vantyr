/**
 * Capture actual UI pixels in an isolated browser, never user camera footage.
 * Requires the running app, Playwright Chromium and ffmpeg.
 * SAFESIGHT_URL includes the artifact base path, with a trailing slash.
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';

const url = process.env.SAFESIGHT_URL || `https://${process.env.REPLIT_DEV_DOMAIN}/`;
const output = resolve('public/walkthrough');
const generated = resolve('../../generated-artifacts/safesight-walkthrough');
await mkdir(output, { recursive: true });
await mkdir(generated, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(new URL('dashboard?source=simulation', url).href);
  await page.getByTestId('button-scenario-sustained').waitFor();
  const banner = page.getByRole('button', { name: 'Close banner', exact: true });
  if (await banner.isVisible()) {
    await banner.click();
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => document.fonts.ready);
  await page.getByTestId('status-simulation').waitFor();
  await page.screenshot({ path: resolve(generated, 'poster.jpg'), type: 'jpeg', quality: 85 });

  // Screen recording from actual browser screenshots. Fixed cadence, no fabricated frames.
  const encoder = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '6',
    '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '32',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', resolve(generated, 'simulation-review.mp4')]);
  let encoderError = '';
  encoder.stderr.on('data', b => { encoderError += b; });
  const finished = once(encoder, 'close');
  let capturing = true;
  const start = Date.now();
  const capture = (async () => {
    let index = 0;
    while (capturing) {
      const image = await page.screenshot({ type: 'jpeg', quality: 85 });
      if (!encoder.stdin.write(image)) await once(encoder.stdin, 'drain');
      index++;
      await new Promise(r => setTimeout(r, Math.max(0, start + index * 1000 / 6 - Date.now())));
    }
    encoder.stdin.end();
  })();
  const at = async (sec) => new Promise(r => setTimeout(r, Math.max(0, start + sec * 1000 - Date.now())));
  try {
    await at(3);
    await page.getByTestId('button-scenario-sustained').click();
    await at(10);
    await page.getByTestId('zone-workflow').scrollIntoViewIfNeeded();
    await at(16);
    await page.getByTestId('link-nav-events').click();
    await page.getByTestId('button-filter-zone').click();
    const row = page.locator('[data-testid^="row-event-"]').first();
    const id = (await row.getAttribute('data-testid')).slice('row-event-'.length);
    await row.locator('[data-testid^="button-expand-"]').click();
    await page.getByTestId(`review-outcome-${id}`).scrollIntoViewIfNeeded();
    await at(22);
    await page.getByTestId(`review-outcome-${id}`).selectOption('no-assistance-needed');
    await page.getByTestId(`button-review-${id}`).click();
    await at(27);
    await page.getByTestId(`status-review-${id}`).scrollIntoViewIfNeeded();
    await at(32);
  } finally {
    capturing = false;
    await capture;
  }
  const [code] = await finished;
  if (code !== 0) throw new Error(`ffmpeg failed: ${encoderError}`);
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
  await rename(resolve(generated, 'simulation-review.mp4'), resolve(output, 'simulation-review.mp4'));
  await rename(resolve(generated, 'poster.jpg'), resolve(output, 'poster.jpg'));
  await writeFile(resolve(generated, 'provenance.json'), JSON.stringify({
    recordedAt: new Date().toISOString(), viewport: '1200x900', fps: 6, duration: 'approximately 32 seconds',
    source: 'Actual SafeSight application pixels, isolated browser, built-in Sustained entry simulation',
    actions: ['Replay sustained entry', 'Read zone flag', 'Open Events and Zones filter', 'Record no-assistance-needed', 'Mark reviewed'],
    cameraRequested: false, syntheticCameraFootage: false, userData: false,
  }, null, 2));
  console.log('Recorded public/walkthrough/simulation-review.mp4 and poster.jpg');
} finally {
  await context.close();
  await browser.close();
}
