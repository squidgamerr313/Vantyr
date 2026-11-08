import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const plan = JSON.parse(await readFile('scripts/src/devpost-plan.json', 'utf8'));
const dir = resolve('generated-artifacts/devpost-video/cards');
await mkdir(dir, { recursive: true });
const base = `https://${process.env.REPLIT_DEV_DOMAIN}/`;
const browser = await chromium.launch({ executablePath: '/repl/tools/bin/chromium' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const descriptions = {
  problem: ['More footage is not the same as better awareness.', 'The problem', 'Notice the moment. Understand the context. Decide what to do.'],
  why: ['Useful information, without uploading every moment.', 'Why this matters', 'Attention is limited. Privacy matters. A person should stay in control.'],
  purpose: ['OBSERVE  →  REVIEW  →  RESPOND', 'Our approach', 'Surface observable cues. Preserve context. Support a human decision.'],
  cues: ['Two current camera rules. Neither is a danger verdict.', 'Current proof of concept', 'Sustained near-horizontal posture / Configured image-zone dwell'],
  privacy: ['CAMERA VIDEO → LOCAL PROCESSING', 'Privacy and consent', 'An optional AI image review sends one still only after preview and consent.'],
  boundaries: ['NOT RELIABLE: assaults / weapon use / malicious intent', 'Current limits', 'Experimental prototype. Human review required. Not a certified safety system.'],
  future: ['NEXT: better labels + independent validation', 'The next step', 'Local observation. Visible evidence. Human review. Controlled responses.'],
};
const notices = {
  purpose: 'Actual VANTYR homepage · experimental proof of concept',
  monitor: 'Actual application · camera setup, followed by a recorded model run',
  engine: 'Actual model outputs · licensed prerecorded input · software graphics, not a device benchmark',
  simulation: 'SIMULATED INPUT · actual application workflow · not a real incident',
  review: 'Simulated event review · response settings shown OFF; no live response is triggered',
};
function html(scene, overlay) {
  const light = ['why', 'privacy', 'boundaries'].includes(scene.visual);
  const description = descriptions[scene.visual] ?? ['', '', ''];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;width:1920px;height:1080px;font-family:Arial,sans-serif;background:${overlay ? 'transparent' : light ? '#f4f1e9' : '#111210'};color:${light && !overlay ? '#181a17' : '#fff'}}
  header{position:absolute;inset:0 0 auto;height:142px;padding:30px 60px;display:flex;align-items:center;gap:20px;${overlay ? 'background:#111210;' : 'border-bottom:1px solid #8884;'}}
  header img{width:60px;height:60px}header b{font-size:38px;letter-spacing:-2px}header div{margin-left:auto;text-align:right;max-width:1320px}
  header small{font:18px monospace;letter-spacing:3px;color:${light && !overlay ? '#66654e' : '#c5b992'}}header h2{font-size:34px;line-height:1.15;letter-spacing:-.8px;margin:10px 0 0}
  main{position:absolute;top:238px;left:112px;right:112px}main p{font:22px monospace;letter-spacing:3px;color:${light ? '#6d6040' : '#c5b992'}}main h1{font-size:104px;max-width:1510px;line-height:1.04;letter-spacing:-5px;margin:28px 0 38px}main h3{font-size:32px;line-height:1.4;max-width:1450px;font-weight:500}
  main .rule{width:100px;height:5px;background:#ad8d4d;margin:35px 0}main .note{font-size:30px;max-width:1450px;color:${light ? '#494b42' : '#cfcec5'};line-height:1.45}
  footer{position:absolute;bottom:0;left:0;right:0;height:178px;background:${overlay ? '#111210' : 'transparent'};padding:18px 60px 0;font:26px monospace;line-height:1.5;color:${light && !overlay ? '#55574e' : '#c1c0b4'}}
  </style></head><body><header><img src="${base}${light && !overlay ? 'safesight-icon-ink.svg' : 'safesight-icon.svg'}"><b>VANTYR</b><div><small>${esc(scene.chapter)}</small>${overlay ? `<h2>${esc(scene.title)}</h2>` : ''}</div></header>
  ${overlay ? '' : `<main><p>${esc(description[1])}</p><h1>${esc(scene.title)}</h1><div class="rule"></div><h3>${esc(description[0])}</h3><div class="note">${esc(description[2])}</div></main>`}
  <footer>${esc(overlay ? notices[scene.visual] ?? 'Actual application recording' : 'VANTYR / Hackathon proof of concept')}</footer></body></html>`;
}
try {
  for (const scene of plan.scenes) {
    const overlay = !!notices[scene.visual];
    await page.setContent(html(scene, overlay), { waitUntil: 'networkidle' });
    await page.screenshot({ path: resolve(dir, `${scene.id}.png`), omitBackground: overlay });
  }
  // Separate editorial credit, never an endorsement by the stock-footage creator.
  await page.setContent(`<!doctype html><style>body{margin:0;width:1920px;height:1080px;background:#111210;color:white;font-family:Arial;display:grid;place-content:center;text-align:center}h1{font-size:150px;margin:0 0 30px;letter-spacing:-8px}p{font-size:36px;line-height:1.4}.c{font:21px monospace;color:#bbb9ae;line-height:1.8}</style><h1>VANTYR</h1><p>Safety intelligence.<br>Built to help people respond.</p><div class=c>Hackathon proof of concept · AI narration<br>Footage: Martina Tomšič / Pexels 4098697 · Pexels license<br>Recorded model outputs and clearly labelled simulation<br>Experimental. Not a certified safety system.</div>`);
  await page.screenshot({ path: resolve(dir, 'credits.png') });
  console.log('Rendered editorial cards, actual-footage overlays, and credits.');
} finally { await browser.close(); }
