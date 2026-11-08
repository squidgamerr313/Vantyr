import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const require = createRequire(new URL('../package.json', import.meta.url));
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const source = readFileSync(new URL('../src/components/hero-engine.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source.replace('import.meta.env.BASE_URL', JSON.stringify('/')), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/from ["']([^"']+)["']/g, (_, spec) => `from ${JSON.stringify(pathToFileURL(require.resolve(spec)).href)}`);
const { HeroEngine } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('initial hero waits for preferences and describes the actual recording', () => {
  const html = renderToStaticMarkup(React.createElement(HeroEngine));
  assert.match(html, /data-testid="hero-recording"/);
  assert.match(html, /data-testid="video-hero-recording"/);
  assert.match(html, /loop=""/);
  assert.match(html, /autoPlay=""/i);
  assert.match(html, /muted=""/);
  assert.match(html, /It is not your camera and not live/);
  assert.doesNotMatch(html, /src="|<svg|<canvas|<iframe|Processing illustration|button-hero-play/i);
});
test('visitor page never starts models, captures media or repeats the schematic', () => {
  const one = renderToStaticMarkup(React.createElement(HeroEngine));
  assert.equal(renderToStaticMarkup(React.createElement(HeroEngine)), one);
  assert.doesNotMatch(source, /\bfetch\s*\(|getUserMedia|createVisionEngine|MonitoringScene|ProductWalkthrough|POSE_A|FIELD\.map/);
});
test('recording respects preferences, suspension, manual pause and teardown', () => {
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /prefers-reduced-data: reduce/);
  assert.match(source, /conn\?\.saveData/);
  assert.match(source, /visible && !document\.hidden && !userPausedRef\.current/);
  assert.match(source, /io\.disconnect\(\)/);
  assert.match(source, /removeEventListener\('visibilitychange', sync\)/);
  assert.match(source, /removeAttribute\('src'\)/);
  assert.match(source, /Pause motion/);
  assert.match(source, /Resume motion/);
  assert.doesNotMatch(source, /Processing illustration|button-hero-play/);
});

test('hero describes the broader purpose without claiming new detection abilities', () => {
  const landing = readFileSync(new URL('../src/pages/landing.tsx', import.meta.url), 'utf8');
  assert.match(landing, /Safety intelligence\. Built to help people respond\./);
  assert.doesNotMatch(landing, /See people, posture and zone activity\. Review what needs attention\./);
  assert.match(landing, /Experimental prototype/);
});

test('settled white copy and navigation retain contrast over a white video frame', () => {
  const css = readFileSync(new URL('../src/pages/landing.css', import.meta.url), 'utf8');
  for (const selector of ['.he-veil', '.lp-masthead']) {
    const block = css.slice(css.indexOf(`${selector} {`)).split('}')[0];
    const alphas = [...block.matchAll(/hsl\(30 10% 5% \/ ([.\d]+)\)/g)].map(m => Number(m[1]));
    assert.ok(alphas.length, `${selector} needs a predictable dark backdrop`);
    const alpha = Math.min(...alphas);
    // hsl(30 10% 5%), composited over the maximum possible RGB video value.
    const rgb = [.055, .05, .045].map(c => c * alpha + 1 - alpha);
    const linear = rgb.map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    const luminance = .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
    assert.ok(1.05 / (luminance + .05) >= 4.5, `${selector} must meet normal-text contrast even over white`);
  }
});
