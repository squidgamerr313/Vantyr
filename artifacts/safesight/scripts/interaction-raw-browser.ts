import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { browserPoseOptions, POSE_WASM_URL } from "../src/lib/pose-runtime-contract";
import type { InteractionFrame } from "../src/lib/interaction-features";

/** Public research fixtures only; no camera, network uploads or action labels. */
export async function extractRawPoses(record: { sequence: number; images: string[] }) {
  if (!Number.isInteger(record.sequence) || record.sequence < 1 || record.sequence > 20
    || record.images.length < 16 || record.images.length > 1600) throw Error("Invalid public fixture");
  const files = await FilesetResolver.forVisionTasks(POSE_WASM_URL);
  const pose = await PoseLandmarker.createFromOptions(files, browserPoseOptions());
  const frames: InteractionFrame[] = [];
  try {
    for (const [index, bytes] of record.images.entries()) {
      const image = new Image();
      image.src = `data:image/jpeg;base64,${bytes}`;
      await image.decode();
      const result = pose.detectForVideo(image, index * 125 + 1);
      frames.push({ timeMs: index * 125, width: image.naturalWidth, height: image.naturalHeight,
        landmarks: result.landmarks.map(p => p.map(j => ({ x: j.x, y: j.y, visibility: j.visibility }))) });
      if (index % 125 === 0) console.info(`RGB seq${record.sequence}: ${index}/${record.images.length} frames`);
    }
    return { sequence: record.sequence, options: browserPoseOptions(), wasm: POSE_WASM_URL, frames };
  } finally { pose.close(); }
}
