import type { ErrorRequestHandler } from "express";

/** Body-parser errors must be readable JSON and must not expose uploaded content. */
export const inputErrors: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  const type = (error as { type?: string })?.type;
  if (type === "entity.too.large") {
    res.setHeader("Cache-Control", "no-store");
    res.status(413).json({ error: "Snapshot request is too large. Capture a smaller JPEG under 4 MB." });
  } else if (type === "entity.parse.failed") {
    res.setHeader("Cache-Control", "no-store");
    res.status(400).json({ error: "Invalid JSON request. Capture a new snapshot and retry." });
  } else next(error);
};
