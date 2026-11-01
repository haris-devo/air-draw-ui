// lib/gestures.test.ts
import { describe, expect, it } from "vitest";
import { classify, createGestureDebouncer, type Landmark } from "./gestures";

type Pose = { index: boolean; middle: boolean; ring: boolean; pinky: boolean; pinch?: number };

// Synthetic upright hand: wrist at the bottom, fingers pointing up.
// Palm size (wrist → middle MCP) is 0.2 * scale.
function hand({ index, middle, ring, pinky, pinch }: Pose, scale = 1): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.9, z: 0 }));
  const at = (x: number, up: number): Landmark => ({ x: 0.5 + x * scale, y: 0.9 - up * scale, z: 0 });
  lm[9] = at(0, 0.2);
  const fingers: [number, number, boolean][] = [
    [8, -0.06, index],
    [12, -0.02, middle],
    [16, 0.02, ring],
    [20, 0.06, pinky],
  ];
  for (const [tip, x, extended] of fingers) {
    lm[tip - 2] = at(x, 0.3); // PIP
    lm[tip] = at(x, extended ? 0.45 : 0.18);
  }
  // Thumb tip: far to the side, or `pinch` palm-widths away from the index tip.
  lm[4] = pinch === undefined ? at(-0.25, 0.15) : { ...lm[8], x: lm[8].x + pinch * 0.2 * scale };
  return lm;
}

const open = { index: true, middle: true, ring: true, pinky: true };

describe("classify", () => {
  it("detects an open palm", () => {
    expect(classify(hand(open), false)).toBe("palm");
  });

  it("detects peace (index + middle up, ring + pinky folded)", () => {
    expect(classify(hand({ index: true, middle: true, ring: false, pinky: false }), false)).toBe("peace");
  });

  it("returns none for a fist or a pointing finger", () => {
    expect(classify(hand({ index: false, middle: false, ring: false, pinky: false }), false)).toBe("none");
    expect(classify(hand({ index: true, middle: false, ring: false, pinky: false }), false)).toBe("none");
  });

  it("starts a pinch below 0.30 and keeps it until 0.45 (hysteresis)", () => {
    expect(classify(hand({ ...open, pinch: 0.25 }), false)).toBe("pinch");
    expect(classify(hand({ ...open, pinch: 0.35 }), false)).toBe("palm");
    expect(classify(hand({ ...open, pinch: 0.35 }), true)).toBe("pinch");
    expect(classify(hand({ ...open, pinch: 0.5 }), true)).toBe("palm");
  });

  it("is independent of distance from the camera", () => {
    for (const scale of [0.4, 1, 1.8]) {
      expect(classify(hand(open, scale), false)).toBe("palm");
      expect(classify(hand({ ...open, pinch: 0.2 }, scale), false)).toBe("pinch");
    }
  });

  it("handles incomplete or degenerate input", () => {
    expect(classify([], false)).toBe("none");
    expect(classify(Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 })), false)).toBe("none");
  });
});

describe("createGestureDebouncer", () => {
  it("ignores flickers shorter than the window", () => {
    const d = createGestureDebouncer(120);
    expect(d.update("pinch", 0)).toBe("none");
    expect(d.update("pinch", 100)).toBe("none");
    expect(d.update("none", 110)).toBe("none");
    expect(d.update("pinch", 200)).toBe("none");
    expect(d.update("pinch", 319)).toBe("none");
    expect(d.update("pinch", 320)).toBe("pinch");
  });

  it("keeps the stable gesture through a short drop-out", () => {
    const d = createGestureDebouncer(120);
    d.update("pinch", 0);
    d.update("pinch", 130);
    expect(d.update("none", 140)).toBe("pinch");
    expect(d.update("pinch", 200)).toBe("pinch");
    expect(d.update("none", 300)).toBe("pinch");
    expect(d.update("none", 420)).toBe("none");
  });

  it("reset drops to none immediately", () => {
    const d = createGestureDebouncer(120);
    d.update("palm", 0);
    d.update("palm", 200);
    d.reset();
    expect(d.update("none", 210)).toBe("none");
  });
});
