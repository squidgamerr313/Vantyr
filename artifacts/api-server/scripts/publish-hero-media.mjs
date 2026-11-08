/** Operator-only publication of reviewed marketing assets. No HTTP upload route. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { heroStorageClient, heroStorageLocation } from '../src/lib/hero-storage.ts';

try {
  const dir = resolve('generated-artifacts/hero-engine-recording');
  for (const [asset, contentType] of [
    ['engine.mp4', 'video/mp4'], ['poster.jpg', 'image/jpeg'], ['provenance.json', 'application/json'],
  ]) {
    const bytes = await readFile(resolve(dir, asset));
    const { bucket, name } = heroStorageLocation(asset);
    await heroStorageClient.bucket(bucket).file(name).save(bytes, {
      resumable: false,
      contentType,
      metadata: {
        cacheControl: 'public, max-age=3600',
        metadata: { sha256: createHash('sha256').update(bytes).digest('hex') },
      },
    });
    console.log(`Published ${asset} (${bytes.length} bytes)`);
  }
} catch (error) {
  // Do not print SDK request/authentication details.
  console.error(`Asset publication failed (${error?.name ?? 'unknown error'})`);
  process.exitCode = 1;
}
