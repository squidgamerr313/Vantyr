import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
// Keep the transient test bundle out of checkpoints/deployments.
const outfile = 'node_modules/.cache/safesight-api.test.cjs';
await build({
  entryPoints: ['tests/all.test.ts'], outfile, bundle: true, platform: 'node', format: 'cjs',
  external: ['express', '@google/genai'],
});
// Node's --test discovery excludes node_modules even for explicit paths.
// Executing the node:test entry directly runs the same tests without discovery.
const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
