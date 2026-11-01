// lib/gestures.ts
// Pure hand-pose classification. Landmark indices follow MediaPipe's 21-point hand model.

export type Gesture = "point" | "palm" | "peace" | "none";
export type Landmark = { x: number; y: number; z: number };

const WRIST = 0;
const MIDDLE_MCP = 9;
const FINGERS = {
  index: { tip: 8, pip: 6 },
  middle: { tip: 12, pip: 10 },
  ring: { tip: 16, pip: 14 },
  pinky: { tip: 20, pip: 18 },
} as const;

const EXTENDED_FACTOR = 1.1;
// While already pointing, the index only has to stay slightly past its PIP joint, so the pen doesn't flicker.
const POINT_KEEP_FACTOR = 1.0;

function dist(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function isExtended(lm: Landmark[], finger: keyof typeof FINGERS, factor = EXTENDED_FACTOR) {
  const { tip, pip } = FINGERS[finger];
  return dist(lm[tip], lm[WRIST]) > dist(lm[pip], lm[WRIST]) * factor;
}

/**
 * Classifies one frame. "point" (only the index finger up) is the pen: the index tip draws.
 * The thumb is ignored, so it can rest anywhere. `wasPointing` adds hysteresis on the index
 * finger so the pen doesn't flicker as it bends slightly. Ratios compare distances from the
 * wrist, so distance from the camera doesn't matter.
 */
export function classify(landmarks: Landmark[], wasPointing: boolean): Gesture {
  if (landmarks.length < 21) return "none";
  if (dist(landmarks[WRIST], landmarks[MIDDLE_MCP]) === 0) return "none";

  const index = isExtended(landmarks, "index", wasPointing ? POINT_KEEP_FACTOR : EXTENDED_FACTOR);
  const middle = isExtended(landmarks, "middle");
  const ring = isExtended(landmarks, "ring");
  const pinky = isExtended(landmarks, "pinky");

  if (index && middle && ring && pinky) return "palm";
  if (index && middle && !ring && !pinky) return "peace";
  if (index && !middle && !ring && !pinky) return "point";
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
