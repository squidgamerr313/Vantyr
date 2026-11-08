import { Router, type IRouter } from 'express';
import { heroStorageClient, heroStorageLocation } from '../lib/hero-storage';

const router: IRouter = Router();
const assets: Record<string, string> = { 'engine.mp4': 'video/mp4', 'poster.jpg': 'image/jpeg' };

// Public marketing assets only. No upload API, arbitrary paths or user recordings.
router.get('/hero-recording/:asset', async (req, res) => {
  const asset = String(req.params.asset);
  if (!Object.hasOwn(assets, asset)) { res.sendStatus(404); return; }
  try {
    const { bucket, name } = heroStorageLocation(asset);
    const file = heroStorageClient.bucket(bucket).file(name);
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size < 1) throw Error('Invalid asset size');
    res.set({
      'Content-Type': assets[asset],
      'Cache-Control': 'public, max-age=3600',
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
    });
    const range = req.headers.range;
    let start = 0, end = size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) {
        res.set('Content-Range', `bytes */${size}`).sendStatus(416); return;
      }
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(Number(match[2]), size - 1);
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size || Number(match[2]) === 0 && !match[1]) {
        res.set('Content-Range', `bytes */${size}`).sendStatus(416); return;
      }
      res.status(206).set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.set('Content-Length', String(end - start + 1));
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = file.createReadStream({ start, end });
    res.on('close', () => stream.destroy());
    stream.on('error', error => {
      req.log.error({ asset, errorType: error.name }, 'Hero recording stream failed');
      if (!res.headersSent) res.sendStatus(502); else res.destroy();
    });
    stream.pipe(res);
  } catch (error) {
    req.log.warn({ asset, errorType: error instanceof Error ? error.name : 'unknown' }, 'Hero recording unavailable');
    res.sendStatus(503);
  }
});
export default router;
