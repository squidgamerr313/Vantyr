import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { browserPoseOptions, POSE_WASM_URL } from "./pose-runtime-contract";
import type { SceneMotion } from "./scene-motion.ts";
import { EVIDENCE_MAX_AGE_MS } from "./monitoring-health.ts";
import { captureOwnedFrame } from "./owned-frame.ts";
import { createOwnedInference, acquireVisionModels } from "./vision-lifecycle.ts";
import { assertPoseImageSupport } from "./vision-support.ts";
import { detailRegions, mapDetailPredictions, mergeDetailPredictions } from "./detail-objects.ts";
import type { ObjectProfile } from "./tool-motion.ts";
import { createDetailObjectModel } from "./detail-object-model.ts";
import { calibrationCrop, createCalibrationEncoder } from "./calibration-encoder.ts";
import { predictCalibration, validateHead, type CalibrationHead, type CalibrationPrediction } from "./calibration.ts";

const yieldControl = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

export interface Detection {
  id: string;
  label: string;
  confidence: number;
  box: [number, number, number, number];
}

export interface PosePoint {
  x: number;
  y: number;
  visibility?: number;
}

export interface VisionResult {
  detections: Detection[];
  objectProfile?: ObjectProfile;
  objectPasses?: number;
  /** Separate experimental crop opinion; never substitutes detector evidence. */
  calibrationReview?: { status: string; baseLabel?: string; prediction?: CalibrationPrediction };
  landmarks: PosePoint[][];
  latency: number;
  stages?: {
    captureMs: number;
    objectMs: number;
    poseMs: number;
    yieldMs: number;
    skippedPose: boolean;
  };
  frameWidth?: number;
  frameHeight?: number;
  /** Decoded video time captured when this inference starts; never a render-loop counter. */
  frameTimeMs?: number;
  /** Research-only opt-in input. The live engine does not populate this unqualified gate. */
  sceneMotion?: SceneMotion;
}

export interface VisionEngine {
  detect(video: HTMLVideoElement, frameTimeMs?: number, evidenceStartedAt?: number): Promise<VisionResult>;
  dispose(): void;
  diagnostics?(): VisionDiagnostics;
}

export interface VisionDiagnostics {
  backend: string;
  objectProfile?: ObjectProfile;
  execution: "main-thread";
  loads: {
    librariesMs: number;
    backendMs: number;
    objectMs: number;
    poseMs: number;
  };
  memory: { numTensors: number; numBytes: number; unreliable: boolean };
}

/** Models execute locally. Only the separately approved scene-analysis action uploads an image. */
export async function createVisionEngine(
  onStatus: (status: string) => void,
  signal: AbortSignal = new AbortController().signal,
  /** Benchmark comparison only. Production keeps WebGL-first and cooperative yields. */
  options: { backend?: "cpu" | "webgl"; yieldBetweenStages?: boolean; objectProfile?: ObjectProfile; calibrationHead?: CalibrationHead } = {},
): Promise<VisionEngine> {
  signal.throwIfAborted();
  const releaseLease = await acquireVisionModels(signal);
  let detector:
    | Awaited<ReturnType<typeof import("@tensorflow-models/coco-ssd").load>>
    | undefined;
  let pose: PoseLandmarker | undefined;
  let detailDetector: Awaited<ReturnType<typeof createDetailObjectModel>> | undefined;
  let calibrationEncoder: Awaited<ReturnType<typeof createCalibrationEncoder>> | undefined;
  let removeAbort = () => {};
  const canvas = document.createElement("canvas");
  const detailCanvas = document.createElement("canvas");
  const objectProfile = options.objectProfile ?? 'balanced';
  const loadStart = performance.now();
  try {
    assertPoseImageSupport();
    onStatus("Loading local vision libraries…");
    const [tf, coco, mediaPipe] = await Promise.all([
      import("@tensorflow/tfjs-core"),
      import("@tensorflow-models/coco-ssd"),
      import("@mediapipe/tasks-vision"),
    ]);
    await import("@tensorflow/tfjs-backend-webgl");
    await import("@tensorflow/tfjs-backend-cpu");
    signal.throwIfAborted();
    const librariesEnd = performance.now();
    try {
      if (options.backend === "cpu" || objectProfile === 'detail')
        throw new Error("CPU requested for benchmark");
      if (!(await tf.setBackend("webgl")))
        throw new Error("WebGL is unavailable");
      await tf.ready();
    } catch {
      onStatus(objectProfile === 'detail' ? "Preparing the local CPU detail detector…" : "WebGL unavailable. Using local CPU inference (may be slower)…");
      if (!(await tf.setBackend("cpu")))
        throw new Error("No supported local inference backend");
      await tf.ready();
    }
    signal.throwIfAborted();
    const backendEnd = performance.now();
    // Keep the WASM runtime pinned to the installed JS version.
    const files = await mediaPipe.FilesetResolver.forVisionTasks(
      POSE_WASM_URL,
    );
    onStatus(objectProfile === 'detail' ? "Downloading and verifying EfficientDet-Lite2 detail model…" : "Downloading object detection model…");
    if (objectProfile === 'detail') detailDetector = await createDetailObjectModel(files, signal);
    else detector = await coco.load({ base: "lite_mobilenet_v2" });
    signal.throwIfAborted();
    const objectEnd = performance.now();
    onStatus("Downloading human pose model…");
    signal.throwIfAborted();
    pose = await mediaPipe.PoseLandmarker.createFromOptions(files, browserPoseOptions());
    signal.throwIfAborted();
    const personalHead = options.calibrationHead ? structuredClone(options.calibrationHead) : undefined;
    if (personalHead) {
      validateHead(personalHead);
      if (tf.getBackend() === 'webgl') {
        onStatus("Loading your tab-only experimental crop reviewer…");
        calibrationEncoder = await createCalibrationEncoder(signal, true);
      }
    }
    const loads = {
      librariesMs: librariesEnd - loadStart,
      backendMs: backendEnd - librariesEnd,
      objectMs: objectEnd - backendEnd,
      poseMs: performance.now() - objectEnd,
    };
    const objectDetector = detector;
    const detailObjectDetector = detailDetector;
    const detectObjects = (image: HTMLCanvasElement, count: number) => detailObjectDetector
      ? detailObjectDetector.detect(image) : objectDetector!.detect(image, count, .2);
    const poseDetector = pose;
    let lastTimestamp = 0;
    let detailPhase = 0;
    const owner = createOwnedInference<
      VisionResult,
      [HTMLVideoElement, number?, number?]
    >({
      async run(video, frameTimeMs = video.currentTime * 1000, evidenceStartedAt = performance.now()) {
        const start = performance.now();
        if (!Number.isFinite(evidenceStartedAt) || evidenceStartedAt > start)
          throw new Error("Invalid evidence observation time");
        const frame = captureOwnedFrame(video, canvas, frameTimeMs);
        const captureEnd = performance.now();
        let yieldMs = 0;
        const checkpoint = async () => {
          if (options.yieldBetweenStages !== false) {
            const began = performance.now();
            await yieldControl();
            yieldMs += performance.now() - began;
          }
          owner.assertCurrent();
          frame.assertSource();
        };
        await checkpoint();
        const objectStart = performance.now();
        let predictions = await detectObjects(frame.image, 20);
        let objectPasses = 1;
        if (objectProfile === 'detail') {
          const all = [...predictions];
          for (const region of detailRegions(predictions, frame.width, frame.height, detailPhase++)) {
            // Bound extra work. The health monitor still rejects the entire
            // result if the source frame exceeds the strict evidence deadline.
            if (performance.now() - evidenceStartedAt >= EVIDENCE_MAX_AGE_MS - 500) break;
            await checkpoint();
            detailCanvas.width = region[2]; detailCanvas.height = region[3];
            const context = detailCanvas.getContext('2d');
            if (!context) throw new Error('Close-up canvas unavailable');
            context.drawImage(frame.image, ...region, 0, 0, region[2], region[3]);
            const closeup = await detectObjects(detailCanvas, 12);
            all.push(...mapDetailPredictions(closeup, region)); objectPasses++;
            owner.assertCurrent(); frame.assertSource();
          }
          predictions = mergeDetailPredictions(all);
        }
        const objectEnd = performance.now();
        await checkpoint();
        const poseStart = performance.now();
        // Expired object work cannot become evidence. Avoid spending more CPU on its pose.
        const skippedPose = poseStart - evidenceStartedAt >= EVIDENCE_MAX_AGE_MS;
        const timestamp = Math.max(poseStart, lastTimestamp + 1);
        lastTimestamp = timestamp;
        const result = skippedPose
          ? null
          : poseDetector.detectForVideo(frame.image, timestamp);
        owner.assertCurrent();
        frame.assertSource();
        const poseEnd = performance.now();
        let calibrationReview: VisionResult['calibrationReview'];
        if (personalHead) {
          calibrationReview = { status: calibrationEncoder ? 'No suitable object crop this frame' : 'Unavailable: requires Balanced profile with WebGL' };
          const candidate = predictions.filter(p => ['knife', 'scissors', 'remote', 'toothbrush', 'spoon', 'fork', 'bottle', 'cell phone'].includes(p.class) &&
            p.score >= .25 && Math.min(p.bbox[2], p.bbox[3]) >= 16 && p.bbox[2] * p.bbox[3] >= 1024).sort((a, b) => b.score - a.score)[0];
          if (candidate && calibrationEncoder) {
            calibrationReview = { status: 'Skipped to preserve frame freshness', baseLabel: candidate.class };
            if (performance.now() - evidenceStartedAt < EVIDENCE_MAX_AGE_MS - 700) {
              const crop = calibrationCrop(frame.image, frame.width, frame.height, candidate.bbox);
              try {
                const features = await calibrationEncoder.encode(crop);
                owner.assertCurrent(); frame.assertSource();
                calibrationReview = { status: 'Experimental crop opinion; no effect on risk or responses', baseLabel: candidate.class,
                  prediction: predictCalibration(personalHead, features) };
              } finally { crop.width = crop.height = 0; }
            }
          }
        }
        return {
          objectProfile,
          objectPasses,
          calibrationReview,
          detections: predictions.map((prediction, index) => ({
            id: `${prediction.class}-${index}`,
            label: prediction.class,
            confidence: prediction.score,
            box: prediction.bbox,
          })),
          landmarks:
            result?.landmarks.map((points) =>
              points.map(({ x, y, visibility }) => ({ x, y, visibility })),
            ) ?? [],
          latency: performance.now() - start,
          stages: {
            captureMs: captureEnd - start,
            objectMs: objectEnd - objectStart,
            poseMs: poseEnd - poseStart,
            yieldMs,
            skippedPose,
          },
          frameTimeMs: frame.frameTimeMs,
          frameWidth: frame.width,
          frameHeight: frame.height,
        };
      },
      release() {
        removeAbort();
        // The parent owned call has settled, so child inference is not in flight.
        void calibrationEncoder?.dispose();
        try {
          detailObjectDetector?.dispose();
          objectDetector?.dispose();
        } finally {
          try {
            poseDetector.close();
          } finally {
            canvas.width = canvas.height = 0;
            detailCanvas.width = detailCanvas.height = 0;
            releaseLease();
          }
        }
      },
    });
    signal.addEventListener("abort", owner.dispose, { once: true });
    removeAbort = () => signal.removeEventListener("abort", owner.dispose);
    onStatus("Local object and pose models ready");
    return {
      detect: owner.detect,
      dispose: owner.dispose,
      diagnostics() {
        const memory = tf.memory();
        return {
          backend: objectProfile === 'detail' ? 'mediapipe-cpu' : tf.getBackend(),
          objectProfile,
          execution: "main-thread",
          loads,
          memory: {
            numTensors: memory.numTensors,
            numBytes: memory.numBytes,
            unreliable: (memory.unreliable ?? false) || objectProfile === 'detail',
          },
        };
      },
    };
  } catch (error) {
    await calibrationEncoder?.dispose();
    removeAbort();
    try {
      detailDetector?.dispose();
      detector?.dispose();
    } finally {
      try {
        pose?.close();
      } finally {
        canvas.width = canvas.height = 0;
        releaseLease();
      }
    }
    if (signal.aborted) throw signal.reason;
    throw new Error(
      `Vision models could not load. Check your connection and browser support, then retry. ${error instanceof Error ? error.message : ""}`,
    );
  }
}
