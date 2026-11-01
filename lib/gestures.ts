// lib/gestures.ts
// Pure hand-pose classification. Landmark indices follow MediaPipe's 21-point hand model.

export type Gesture = "pinch" | "palm" | "peace" | "none";
export type Landmark = { x: number; y: number; z: number };

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const FINGERS = {
  index: { tip: 8, pip: 6 },
  middle: { tip: 12, pip: 10 },
  ring: { tip: 16, pip: 14 },
  pinky: { tip: 20, pip: 18 },
} as const;

const PINCH_START = 0.3;
const PINCH_KEEP = 0.45;
const EXTENDED_FACTOR = 1.1;

function dist(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function isExtended(lm: Landmark[], finger: keyof typeof FINGERS) {
  const { tip, pip } = FINGERS[finger];
  return dist(lm[tip], lm[WRIST]) > dist(lm[pip], lm[WRIST]) * EXTENDED_FACTOR;
}

/**
 * Classifies one frame. `wasPinching` adds hysteresis: a pinch starts below 0.30
 * but only ends above 0.45, so the pen doesn't flicker at the threshold.
 * All distances are divided by palm size (wrist → middle MCP), so camera distance doesn't matter.
 */
export function classify(landmarks: Landmark[], wasPinching: boolean): Gesture {
  if (landmarks.length < 21) return "none";
  const palm = dist(landmarks[WRIST], landmarks[MIDDLE_MCP]);
  if (palm === 0) return "none";

  const pinchRatio = dist(landmarks[THUMB_TIP], landmarks[INDEX_TIP]) / palm;
  if (pinchRatio < (wasPinching ? PINCH_KEEP : PINCH_START)) return "pinch";

  const index = isExtended(landmarks, "index");
  const middle = isExtended(landmarks, "middle");
  const ring = isExtended(landmarks, "ring");
  const pinky = isExtended(landmarks, "pinky");

  if (index && middle && ring && pinky) return "palm";
  if (index && middle && !ring && !pinky) return "peace";
  return "none";
}

/**
 * Debounces gesture changes: a new gesture only takes over after it has been
 * seen continuously for `ms`. Flickers shorter than that are ignored.
 */
export function createGestureDebouncer(ms: number) {
  let stable: Gesture = "none";
  let candidate: Gesture = "none";
  let since = 0;
  return {
    update(raw: Gesture, now: number): Gesture {
      if (raw === stable) {
        candidate = stable;
      } else if (raw !== candidate) {
        candidate = raw;
        since = now;
      } else if (now - since >= ms) {
        stable = raw;
      }
      return stable;
    },
    /** Hand left the frame: drop everything at once (pen up immediately). */
    reset() {
      stable = "none";
      candidate = "none";
    },
  };
}
