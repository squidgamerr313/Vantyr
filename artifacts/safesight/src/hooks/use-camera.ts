import { useEffect, useRef, useState } from 'react';
import { createCameraSession, IDLE_CAMERA, type CameraState } from '@/lib/camera-session';
export type { CameraStatus } from '@/lib/camera-session';

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<CameraState>(IDLE_CAMERA);
  const controller = useRef<ReturnType<typeof createCameraSession> | null>(null);
  if (!controller.current) controller.current = createCameraSession({
    video: () => videoRef.current,
    getUserMedia: (constraints) => {
      if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error('Camera access requires HTTPS and a supported browser. You can still use simulation.'));
      return navigator.mediaDevices.getUserMedia(constraints);
    },
    publish: setState,
  });
  const { start, stop } = controller.current;
  useEffect(() => () => stop(false), [stop]);
  return { videoRef, ...state, start, stop };
}
