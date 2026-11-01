// hooks/use-hand-tracker.ts
// Client-only: imported from the Studio client boundary (webcam stream, wasm model, rAF loop).

import { useEffect, useRef, useState, type RefObject } from "react";
import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

// Pinned to the installed package version so the wasm matches the JS bundle.
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export type TrackerStatus = "loading" | "ready" | "denied" | "unavailable" | "off";

/**
 * Called on every animation frame.
 * `hand` is the landmark list, `null` when no hand is in view,
 * or `undefined` when no new video frame was analysed this tick.
 */
export type FrameHandler = (hand: NormalizedLandmark[] | null | undefined, now: number) => void;

async function createLandmarker(): Promise<HandLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO" as const,
    numHands: 1,
  });
  try {
    return await HandLandmarker.createFromOptions(fileset, options("GPU"));
  } catch {
    // Some machines (no WebGL2, blocked GPU) cannot run the GPU delegate.
    return HandLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

export function useHandTracker(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  onFrame: FrameHandler,
): TrackerStatus {
  const [status, setStatus] = useState<TrackerStatus>("loading");
  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    onFrameRef.current = onFrame;
  });

  useEffect(() => {
    const videoEl = videoRef.current;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let landmarker: HandLandmarker | null = null;
    let raf = 0;
    let lastVideoTime = -1;
    let lastTimestamp = 0;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const video = videoRef.current;
      let hand: NormalizedLandmark[] | null | undefined;
      // Only analyse frames the camera has actually delivered.
      if (landmarker && video && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        // detectForVideo needs strictly increasing timestamps.
        const ts = Math.max(now, lastTimestamp + 1);
        lastTimestamp = ts;
        hand = landmarker.detectForVideo(video, ts).landmarks[0] ?? null;
      }
      onFrameRef.current(hand, now);
    };
    raf = requestAnimationFrame(loop);

    if (enabled) {
      // Each resource is kept (or disposed, if we unmounted meanwhile) as soon as it lands,
      // so nothing leaks when the other one fails or the component goes away mid-load.
      // Wrapped in a promise: navigator.mediaDevices is undefined on insecure origins and would throw.
      const media = Promise.resolve()
        .then(() =>
          navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
            audio: false,
          }),
        )
        .then((m) => {
          if (cancelled) m.getTracks().forEach((t) => t.stop());
          else stream = m;
          return m;
        });
      const model = createLandmarker().then((l) => {
        if (cancelled) l.close();
        else landmarker = l;
        return l;
      });
      Promise.all([media, model])
        .then(async ([m]) => {
          if (cancelled || !videoEl) return;
          videoEl.srcObject = m;
          await videoEl.play();
          if (!cancelled) setStatus("ready");
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          // If only the model failed, don't leave the camera light on.
          stream?.getTracks().forEach((t) => t.stop());
          const name = error instanceof DOMException ? error.name : "";
          setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
        });
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      landmarker?.close();
      if (videoEl) videoEl.srcObject = null;
    };
  }, [enabled, videoRef]);

  return enabled ? status : "off";
}
