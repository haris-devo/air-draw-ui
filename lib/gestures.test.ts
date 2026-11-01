// lib/gestures.test.ts
import { describe, expect, it } from "vitest";
import { classify, createGestureDebouncer, type Landmark } from "./gestures";

type Pose = { index: boolean | number; middle: boolean; ring: boolean; pinky: boolean };

// Synthetic upright hand: wrist at the bottom, fingers pointing up.
// Palm size (wrist → middle MCP) is 0.2 * scale.
// `index` may also be a tip height, to test the pointing hysteresis (PIP sits at 0.3).
function hand({ index, middle, ring, pinky }: Pose, scale = 1): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.9, z: 0 }));
  const at = (x: number, up: number): Landmark => ({ x: 0.5 + x * scale, y: 0.9 - up * scale, z: 0 });
  lm[9] = at(0, 0.2);
  const fingers: [number, number, boolean | number][] = [
    [8, -0.06, index],
    [12, -0.02, middle],
    [16, 0.02, ring],
    [20, 0.06, pinky],
  ];
  for (const [tip, x, extended] of fingers) {
    lm[tip - 2] = at(x, 0.3); // PIP
    lm[tip] = at(x, typeof extended === "number" ? extended : extended ? 0.45 : 0.18);
  }
  lm[4] = at(-0.25, 0.15); // thumb, off to the side
  return lm;
}

const open = { index: true, middle: true, ring: true, pinky: true };
const point = { index: true, middle: false, ring: false, pinky: false };

describe("classify", () => {
  it("detects an open palm", () => {
    expect(classify(hand(open), false)).toBe("palm");
  });

  it("detects peace (index + middle up, ring + pinky folded)", () => {
    expect(classify(hand({ index: true, middle: true, ring: false, pinky: false }), false)).toBe("peace");
  });

  it("detects a pointing index finger as the pen, and a fist as none", () => {
    expect(classify(hand(point), false)).toBe("point");
    expect(classify(hand({ index: false, middle: false, ring: false, pinky: false }), false)).toBe("none");
  });

  it("keeps pointing while the index bends a little (hysteresis)", () => {
    // Tip at 0.32 vs PIP at 0.3: past the PIP, but not by the 10% needed to start.
    const bent = { ...point, index: 0.32 };
    expect(classify(hand(bent), false)).toBe("none");
    expect(classify(hand(bent), true)).toBe("point");
    expect(classify(hand({ ...point, index: 0.18 }), true)).toBe("none");
  });

  it("is independent of distance from the camera", () => {
    for (const scale of [0.4, 1, 1.8]) {
      expect(classify(hand(open, scale), false)).toBe("palm");
      expect(classify(hand(point, scale), false)).toBe("point");
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
    expect(d.update("point", 0)).toBe("none");
    expect(d.update("point", 100)).toBe("none");
    expect(d.update("none", 110)).toBe("none");
    expect(d.update("point", 200)).toBe("none");
    expect(d.update("point", 319)).toBe("none");
    expect(d.update("point", 320)).toBe("point");
  });

  it("keeps the stable gesture through a short drop-out", () => {
    const d = createGestureDebouncer(120);
    d.update("point", 0);
    d.update("point", 130);
    expect(d.update("none", 140)).toBe("point");
    expect(d.update("point", 200)).toBe("point");
    expect(d.update("none", 300)).toBe("point");
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
