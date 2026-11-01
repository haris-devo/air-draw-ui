// hooks/use-strokes.ts
// Client-only. Stroke data lives in refs so the per-frame draw loop never triggers React renders.

import { useMemo, useRef } from "react";
import type { Point, Stroke } from "@/lib/draw";

// Skip points closer than this (in height units) to keep strokes light.
const MIN_STEP = 0.003;

export type Strokes = ReturnType<typeof useStrokes>;

export function useStrokes() {
  const done = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  // Bumped whenever committed strokes change; the canvas redraws when it sees a new value.
  const version = useRef(0);

  return useMemo(
    () => ({
      done,
      current,
      version,
      begin(p: Point) {
        current.current = [p];
      },
      extend(p: Point) {
        const stroke = current.current;
        if (!stroke) return;
        const last = stroke[stroke.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) >= MIN_STEP) stroke.push(p);
      },
      end() {
        if (current.current) {
          done.current.push(current.current);
          current.current = null;
          version.current++;
        }
      },
      clear() {
        done.current = [];
        current.current = null;
        version.current++;
      },
      all(): Stroke[] {
        return current.current ? [...done.current, current.current] : done.current;
      },
    }),
    [],
  );
}
