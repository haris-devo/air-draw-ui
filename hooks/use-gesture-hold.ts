// hooks/use-gesture-hold.ts
// Client-only. Hold timing is driven from the rAF loop and kept in refs (no per-frame state).

import { useEffect, useMemo, useRef } from "react";

/**
 * Tracks how long a gesture has been held. Call `update` every frame;
 * it returns progress 0..1 and fires `onComplete` once per hold.
 * The gesture must be released before it can fire again.
 */
export function useGestureHold(durationMs: number, onComplete: () => void) {
  const startedAt = useRef<number | null>(null);
  const fired = useRef(false);
  const callback = useRef(onComplete);
  useEffect(() => {
    callback.current = onComplete;
  });

  return useMemo(
    () => ({
      update(active: boolean, now: number): number {
        if (!active) {
          startedAt.current = null;
          fired.current = false;
          return 0;
        }
        if (fired.current) return 0;
        startedAt.current ??= now;
        const progress = Math.min((now - startedAt.current) / durationMs, 1);
        if (progress >= 1) {
          fired.current = true;
          callback.current();
        }
        return progress;
      },
    }),
    [durationMs],
  );
}
