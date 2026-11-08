import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { browserPoseOptions, POSE_WASM_URL } from "../src/lib/pose-runtime-contract";
import { interactionFeatures, INTERACTION_CONTRACT, type InteractionFrame } from "../src/lib/interaction-features";

export async function extractInteractionVideo(record: { sequence: number; frames: string[]; images: string[] }) {
  if (!Number.isInteger(record.sequence) || record.sequence < 1 || record.sequence > 20
    || record.images.length !== record.frames.length
    || record.frames.some(p => !new RegExp(`^frames/seq${record.sequence}/\\d{5}\\.jpg$`).test(p))) throw Error("Invalid researcher fixture");
  const files = await FilesetResolver.forVisionTasks(POSE_WASM_URL);
  const pose = await PoseLandmarker.createFromOptions(files, browserPoseOptions());
  const frames: InteractionFrame[] = [], windows: unknown[] = [], unavailable: Record<string, number> = {};
  try {
    for (let index = 0; index < record.frames.length; index++) {
      const image = new Image();
      // Researcher-supplied publisher frames travel over local browser IPC,
      // not one public preview-proxy HTTP request per decoded frame.
      image.src = `data:image/jpeg;base64,${record.images[index]}`;
      await image.decode();
      const timeMs = index * 125;
      const result = pose.detectForVideo(image, timeMs + 1);
      const frame: InteractionFrame = { timeMs, width: image.naturalWidth, height: image.naturalHeight,
        landmarks: result.landmarks.map(person => person.map(p => ({ x: p.x, y: p.y, visibility: p.visibility }))) };
      frames.push(frame);
      if (index % 125 === 0) console.info(`RGB seq${record.sequence}: ${index}/${record.frames.length} frames`);
      if (frames.length > 16) frames.shift();
      if (frames.length === 16 && index % 2 === 1) {
        const window = interactionFeatures(frames);
        if (window.ok) windows.push({ ...window, startMs: frames[0]!.timeMs });
        else unavailable[window.reason] = (unavailable[window.reason] ?? 0) + 1;
      }
    }
    return { sequence: record.sequence, contract: INTERACTION_CONTRACT, totalFrames: record.frames.length,
      sampledWindows: windows.length + Object.values(unavailable).reduce((a, b) => a + b, 0), windows, unavailable };
  } finally { pose.close(); }
}
