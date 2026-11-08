import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';

// Read-only UI audit in isolated browser storage. No camera permissions or uploads.
const base = process.env.SAFESIGHT_URL || `https://${process.env.REPLIT_DEV_DOMAIN}/`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const report = [];
const luminance = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
  .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};
try {
  for (const viewport of [{width:1440,height:1000}, {width:390,height:844}]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    for (const route of ['', 'dashboard', 'events', 'settings', 'docs']) {
      await page.goto(new URL(route, base).href);
      await page.locator('h1').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const banner = page.getByRole('button', { name: 'Close banner', exact: true });
      if (await banner.isVisible()) await banner.click();
      // Include secondary diagnostics and zone inputs without starting any actions.
      await page.locator('details').evaluateAll(nodes => nodes.forEach(node => { node.open = true; }));
      // Trigger one-time scroll reveals, then measure their settled colors rather
      // than intermediate fade opacity (reduced motion does not disable opacity).
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let top = 0; top < height; top += viewport.height * .75) {
        await page.evaluate(y => window.scrollTo({ top:y, behavior:'instant' }), top);
        await page.waitForTimeout(60);
      }
      await page.evaluate(() => window.scrollTo({ top:0, behavior:'instant' }));
      await page.waitForTimeout(1200);
      const audit = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
      // axe cannot resolve layered gradients. Also check landing text against
      // conservative solid bounds: the brightest dark-band and darkest light-
      // band backdrops, including the translucent card overlay. This is a
      // separate stress check, not a claim that axe measured gradient pixels.
      let gradientSurfaceAudit;
      if (!route || route === 'docs') {
        const bounds = await page.addStyleTag({ content: `
          .lp-dark { background:rgb(40, 74, 178) !important; }
          .lp, .lp-light { background:rgb(200, 223, 252) !important; }
          .lp-card:not(.lp-card--dark), .lp-walk { background:#f4f8ff !important; }
          .lp-card--dark { background:rgb(56, 87, 184) !important; }
          .lp-step.is-active { background:rgb(55, 100, 198) !important; }
          .dc-hero { background:rgb(40, 74, 178) !important; }
          .dc-chat-head { background:#2347db !important; }
        ` });
        gradientSurfaceAudit = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
        await bounds.evaluate(node => node.remove());
      }
      const gradients = await page.locator('.lp-cta').evaluateAll(nodes => nodes.map(node => {
        const s = getComputedStyle(node);
        const rgb = value => [...value.matchAll(/rgba?\(([^)]+)\)/g)].map(m => m[1].split(',').slice(0,3).map(Number));
        return { label: node.textContent.trim(), foreground: rgb(s.color)[0], stops: rgb(s.backgroundImage) };
      }));
      const gradientRatios = gradients.map(g => ({
        label: g.label, minimumRatio: Math.min(...g.stops.map(bg => contrast(g.foreground, bg))),
      }));
      const entry = {
        viewport, route: route || '/', passes: audit.passes.reduce((n, r) => n + r.nodes.length, 0),
        violations: audit.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target:n.target, reason:n.failureSummary })) })),
        manualReview: audit.incomplete.map(v => ({ id:v.id, nodes:v.nodes.map(n => n.target) })),
        gradientSurfaceChecks: gradientSurfaceAudit?.passes.reduce((n, r) => n + r.nodes.length, 0),
        gradientSurfaceViolations: gradientSurfaceAudit?.violations.map(v => ({
          id:v.id, nodes:v.nodes.map(n => ({ target:n.target, reason:n.failureSummary })),
        })) || [],
        gradientRatios,
      };
      report.push(entry);
      console.log(`${viewport.width}px /${route}: ${entry.passes} contrast checks; ${entry.violations.length} violations; gradient-surface checks ${entry.gradientSurfaceChecks || 'n/a'}, violations ${entry.gradientSurfaceViolations.length}; CTA minimums ${gradientRatios.map(g => g.minimumRatio.toFixed(2)).join(', ') || 'n/a'}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
await mkdir('../../generated-artifacts/safesight-contrast', { recursive: true });
await writeFile('../../generated-artifacts/safesight-contrast/report.json', JSON.stringify(report, null, 2));
if (report.some(r => r.violations.length || r.gradientSurfaceViolations.length || r.gradientRatios.some(g => g.minimumRatio < 4.5))) {
  console.error(JSON.stringify(report.filter(r => r.violations.length || r.gradientSurfaceViolations.length || r.gradientRatios.some(g => g.minimumRatio < 4.5)), null, 2));
  process.exitCode = 1;
}
