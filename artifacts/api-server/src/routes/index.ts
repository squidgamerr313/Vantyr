import { Router, type IRouter } from "express";
import healthRouter from "./health";
import safetyRouter from "./safety";
import setupRouter from "./setup";
import heroMediaRouter from "./hero-media";

const router: IRouter = Router();

router.use(healthRouter);
router.use(safetyRouter);
router.use(setupRouter);
router.use(heroMediaRouter);
// Retire the cloud path, including calls from stale browser tabs. Do not mount
// the historical provider adapter: speech is now a browser-only feature.
router.post("/speech/review", (_req, res) => {
  res.status(410).json({ error: "Cloud speech review is disabled. Reload VANTYR to use on-device speech processing. No audio was forwarded." });
});

export default router;
