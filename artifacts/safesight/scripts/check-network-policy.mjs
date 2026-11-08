/** Isolated no-media network check. No real provider request or creator storage. */
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const output = process.argv[process.argv.indexOf('--output') + 1];
if (!process.argv.includes('--output') || !resolve(output).startsWith(resolve(root, 'generated-artifacts') + '/'))
  throw Error('Use --output generated-artifacts/NEW.json');
const html = await readFile(resolve(root, 'artifacts/safesight/index.html'), 'utf8');
const policy = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
if (!policy) throw Error('Missing app network policy');
const base = new URL(process.env.SAFESIGHT_URL || `https://${process.env.REPLIT_DEV_DOMAIN}/`);
const result = { status: 'running', mediaUsed: false, policy, unexpectedTransport: [],
  syntheticApiStatus: null, syntheticApiRequests: 0, policyViolations: [] };
const browser = await chromium.launch({ executablePath: '/repl/tools/bin/chromium',
  args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext(), page = await context.newPage();
  await page.addInitScript(() => {
    window.__policyViolations = [];
    addEventListener('securitypolicyviolation', event => {
      let origin = 'non-network';
      try { origin = new URL(event.blockedURI).origin; } catch {}
      window.__policyViolations.push({ directive: event.effectiveDirective, blockedOrigin: origin });
    });
  });
  await page.route('**/*', route => {
    const req = route.request();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
      const url = new URL(req.url());
      result.unexpectedTransport.push({ method: req.method(), origin: url.origin, path: url.pathname });
      return route.abort();
    }
    return route.continue();
  });
  // Synthetic, explicitly initiated same-origin POST: fulfilled locally, never
  // reaches the API/provider and contains no image or recorded observations.
  const api = new URL('api/safety/analyze', base);
  await page.route(api.href, route => {
    result.syntheticApiRequests++;
    if (route.request().method() !== 'POST' || route.request().postData() !== 'network-policy-no-media-control')
      throw Error('Unexpected synthetic API fixture');
    return route.fulfill({ contentType: 'application/json', body: '{"networkPolicyControl":true}' });
  });
  await page.route(new URL('__network_policy_control', base).href, route => route.fulfill({
    contentType: 'text/html', body: `<!doctype html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><title>No-media network control</title></head>`,
  }));
  await page.goto(new URL('__network_policy_control', base).href);
  if (await page.evaluate(() => localStorage.length || sessionStorage.length))
    throw Error('Control context storage not empty');
  result.syntheticApiStatus = await page.evaluate(async url =>
    (await fetch(url, { method: 'POST', body: 'network-policy-no-media-control' })).status, api.href);
  await page.evaluate(async basePath => {
    const { createVisionEngine } = await import(`${basePath}src/lib/vision.ts`);
    const engine = await createVisionEngine(() => {});
    window.__controlDiagnostics = engine.diagnostics();
    engine.dispose();
    await new Promise(resolve => setTimeout(resolve, 500));
  }, base.pathname);
  result.model = await page.evaluate(() => window.__controlDiagnostics);
  result.policyViolations = await page.evaluate(() => window.__policyViolations);
  if (result.unexpectedTransport.length || result.syntheticApiStatus !== 200 || result.syntheticApiRequests !== 1 ||
      !result.policyViolations.some(v => v.blockedOrigin === 'https://odml.pa.googleapis.com') ||
      result.policyViolations.some(v => v.directive !== 'connect-src' ||
        !['https://odml.pa.googleapis.com', 'wss://localhost:23777'].includes(v.blockedOrigin)))
    throw Error('Network policy control failed');
  result.status = 'passed';
} catch (error) {
  result.status = 'failed'; result.error = String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(resolve(output), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(result, null, 2));
}
