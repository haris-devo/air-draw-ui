// components/air-canvas.tsx
// Client-only: imported from the Studio client boundary (webcam, canvases, rAF loop).

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Hand, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useHandTracker, type FrameHandler, type TrackerStatus } from "@/hooks/use-hand-tracker";
import { useGestureHold } from "@/hooks/use-gesture-hold";
import type { Strokes } from "@/hooks/use-strokes";
import { drawNeonStroke, type Point } from "@/lib/draw";
import { classify, createGestureDebouncer, type Gesture } from "@/lib/gestures";
import { cn } from "@/lib/utils";

const EMA_ALPHA = 0.35;
const DEBOUNCE_MS = 120;
const CLEAR_HOLD_MS = 1000;
const GENERATE_HOLD_MS = 800;
const TRAIL_LENGTH = 14;
const DEFAULT_ASPECT = 16 / 9;

export type CanvasStatus = { tracker: TrackerStatus; hand: boolean; drawing: boolean };

type Props = {
  strokes: Strokes;
  /** Ignore all input (used while generating). */
  frozen: boolean;
  /** Pulse the strokes (generating). */
  pulsing: boolean;
  penMode: boolean;
  onUsePen: () => void;
  onGenerate: () => void;
  onClear: () => void;
  onStatusChange: (status: CanvasStatus) => void;
};

export function AirCanvas({
  strokes,
  frozen,
  pulsing,
  penMode,
  onUsePen,
  onGenerate,
  onClear,
  onStatusChange,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);

  const [aspect, setAspect] = useState(DEFAULT_ASPECT);
  const [hand, setHand] = useState(false);
  const [drawing, setDrawing] = useState(false);

  // Per-frame state, kept out of React.
  const loop = useRef({
    debouncer: createGestureDebouncer(DEBOUNCE_MS),
    rawGesture: "none" as Gesture,
    tip: null as Point | null,
    trail: [] as Point[],
    pen: null as "hand" | "pointer" | null,
    hand: false,
    inkVersion: -1,
    hold: null as { progress: number; kind: "clear" | "generate" } | null,
  });

  const clearHold = useGestureHold(CLEAR_HOLD_MS, onClear);
  const generateHold = useGestureHold(GENERATE_HOLD_MS, onGenerate);

  const setPen = (pen: "hand" | "pointer" | null) => {
    if (loop.current.pen === pen) return;
    loop.current.pen = pen;
    setDrawing(pen !== null);
  };

  const onFrame: FrameHandler = (frameLandmarks, now) => {
    // In pen mode the camera is off: treat it as "no hand" so a stroke cut off mid-air ends and the cursor goes away.
    const landmarks = penMode ? null : frameLandmarks;
    const s = loop.current;
    const ink = inkRef.current;
    const live = liveRef.current;
    if (!ink || !live) return;

    if (frozen && s.pen) {
      strokes.end();
      setPen(null);
    }

    if (landmarks === null) {
      // Hand left the frame: pen up at once and cancel any hold.
      s.debouncer.reset();
      s.rawGesture = "none";
      s.tip = null;
      s.trail = [];
      s.hold = null;
      clearHold.update(false, now);
      generateHold.update(false, now);
      if (s.pen === "hand") {
        strokes.end();
        setPen(null);
      }
      if (s.hand) {
        s.hand = false;
        setHand(false);
      }
    } else if (landmarks) {
      if (!s.hand) {
        s.hand = true;
        setHand(true);
      }
      s.rawGesture = classify(landmarks, s.rawGesture === "point");
      const gesture = s.debouncer.update(s.rawGesture, now);

      // Mirror x because the video is shown mirrored; units are canvas heights.
      const ar = live.width / live.height;
      const raw = { x: (1 - landmarks[8].x) * ar, y: landmarks[8].y };
      s.tip = s.tip
        ? { x: s.tip.x + EMA_ALPHA * (raw.x - s.tip.x), y: s.tip.y + EMA_ALPHA * (raw.y - s.tip.y) }
        : raw;
      s.trail.push(s.tip);
      if (s.trail.length > TRAIL_LENGTH) s.trail.shift();

      if (!frozen && gesture === "point") {
        if (s.pen !== "hand") {
          if (s.pen === "pointer") strokes.end();
          strokes.begin(s.tip);
          setPen("hand");
        } else if (s.rawGesture === "point") {
          // While the hand is changing pose the debouncer still says "point";
          // don't extend then, or every stroke ends with a stray tail.
          strokes.extend(s.tip);
        }
      } else if (s.pen === "hand") {
        strokes.end();
        setPen(null);
      }

      const clear = clearHold.update(!frozen && gesture === "palm", now);
      const generate = generateHold.update(!frozen && gesture === "peace", now);
      s.hold =
        clear > 0 ? { progress: clear, kind: "clear" } : generate > 0 ? { progress: generate, kind: "generate" } : null;
    }

    render(s, ink, live);
  };

  const render = (s: typeof loop.current, ink: HTMLCanvasElement, live: HTMLCanvasElement) => {
    const dpr = window.devicePixelRatio || 1;
    const scale = live.height;

    // Committed strokes: redrawn only when they change (or the canvas resized).
    if (s.inkVersion !== strokes.version.current) {
      s.inkVersion = strokes.version.current;
      const ctx = ink.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, ink.width, ink.height);
        for (const stroke of strokes.done.current) drawNeonStroke(ctx, stroke, scale, dpr);
      }
    }

    const ctx = live.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, live.width, live.height);
    if (strokes.current.current) drawNeonStroke(ctx, strokes.current.current, scale, dpr);

    // Fading fingertip trail.
    s.trail.forEach((p, i) => {
      ctx.beginPath();
      ctx.fillStyle = `rgba(103, 232, 249, ${((i + 1) / s.trail.length) * 0.35})`;
      ctx.arc(p.x * scale, p.y * scale, ((i + 1) / s.trail.length) * 4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    });

    if (s.tip) {
      const x = s.tip.x * scale;
      const y = s.tip.y * scale;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, (s.pen === "hand" ? 7 : 9) * dpr, 0, Math.PI * 2);
      if (s.pen === "hand") {
        ctx.shadowColor = "rgba(34, 211, 238, 1)";
        ctx.shadowBlur = 16 * dpr;
        ctx.fillStyle = "rgba(165, 243, 252, 1)";
        ctx.fill();
      } else {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
      }
      ctx.restore();

      if (s.hold) {
        const color = s.hold.kind === "clear" ? "251, 113, 133" : "34, 211, 238";
        const r = 26 * dpr;
        ctx.save();
        ctx.lineWidth = 4 * dpr;
        ctx.lineCap = "round";
        ctx.strokeStyle = `rgba(${color}, 0.2)`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowColor = `rgba(${color}, 1)`;
        ctx.shadowBlur = 12 * dpr;
        ctx.strokeStyle = `rgba(${color}, 1)`;
        ctx.beginPath();
        ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + s.hold.progress * Math.PI * 2);
        ctx.stroke();
        ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = `rgba(${color}, 1)`;
        ctx.fillText(s.hold.kind === "clear" ? "Clear" : "Generate", x, y - r - 10 * dpr);
        ctx.restore();
      }
    }
  };

  const tracker = useHandTracker(videoRef, !penMode, onFrame);

  useEffect(() => {
    onStatusChange({ tracker, hand, drawing });
  }, [tracker, hand, drawing, onStatusChange]);

  // Keep both canvases at device resolution; force an ink redraw after each resize.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.round(entry.contentRect.width * dpr);
      const height = Math.round(entry.contentRect.height * dpr);
      for (const canvas of [inkRef.current, liveRef.current]) {
        if (canvas && (canvas.width !== width || canvas.height !== height)) {
          canvas.width = width;
          canvas.height = height;
        }
      }
      loop.current.inkVersion = -1;
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const toUnits = (e: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.height, y: (e.clientY - rect.top) / rect.height };
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (frozen || loop.current.pen === "hand") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    strokes.begin(toUnits(e));
    setPen("pointer");
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (loop.current.pen === "pointer") strokes.extend(toUnits(e));
  };
  const onPointerUp = () => {
    if (loop.current.pen === "pointer") {
      strokes.end();
      setPen(null);
    }
  };

  const blocked = tracker === "denied" || tracker === "unavailable";

  return (
    <div className="relative grid size-full place-items-center" style={{ containerType: "size" }}>
      <div
        ref={frameRef}
        className="relative overflow-hidden rounded-2xl border border-white/10 bg-neutral-900 shadow-[0_0_80px_-20px_rgba(34,211,238,0.25)]"
        style={{ aspectRatio: aspect, width: `min(100cqw, calc(100cqh * ${aspect}))` }}
      >
        <video
          ref={videoRef}
          className={cn(
            "absolute inset-0 size-full -scale-x-100 object-cover brightness-[0.6] saturate-[0.8]",
            penMode && "hidden",
          )}
          onLoadedMetadata={(e) => {
            const { videoWidth, videoHeight } = e.currentTarget;
            if (videoWidth && videoHeight) setAspect(videoWidth / videoHeight);
          }}
          autoPlay
          muted
          playsInline
        />
        {penMode && (
          <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,255,255,0.07)_1px,transparent_1px)] bg-size-[24px_24px]" />
        )}
        <canvas ref={inkRef} className={cn("absolute inset-0 size-full", pulsing && "stroke-pulse")} />
        <canvas
          ref={liveRef}
          className={cn("absolute inset-0 size-full touch-none", frozen ? "cursor-wait" : "cursor-crosshair")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-label="Drawing canvas"
        />

        {tracker === "loading" && (
          <div className="absolute inset-0 grid place-items-center">
            <Skeleton className="absolute inset-0 rounded-none bg-neutral-800/60" />
            <div className="relative flex flex-col items-center gap-3 text-sm text-neutral-300">
              <Hand className="size-8 animate-pulse text-cyan-300" />
              Loading hand tracking…
              <button
                type="button"
                onClick={onUsePen}
                className="text-xs text-neutral-500 underline-offset-4 hover:text-neutral-300 hover:underline"
              >
                Skip and draw with a pen or mouse
              </button>
            </div>
          </div>
        )}

        {blocked && (
          <div className="absolute inset-0 grid place-items-center bg-neutral-950/85 p-6 text-center">
            <div className="flex max-w-sm flex-col items-center gap-3">
              <Hand className="size-8 text-rose-300" />
              <p className="text-base font-medium text-neutral-100">
                {tracker === "denied" ? "Camera access is blocked" : "Hand tracking couldn't start"}
              </p>
              <p className="text-sm text-neutral-400">
                {tracker === "denied"
                  ? "Allow the camera in your browser's address bar and reload to draw in the air. You can also draw with a pen, the mouse or a finger on a touch screen."
                  : "No camera was found, or this browser can't run the hand model. You can still draw with a pen, the mouse or a finger on a touch screen."}
              </p>
              <Button onClick={onUsePen} className="mt-1">
                <PenLine />
                Use pen mode
              </Button>
            </div>
          </div>
        )}

        {tracker === "ready" && !hand && (
          <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-neutral-950/70 px-4 py-2 text-sm text-neutral-200 backdrop-blur">
              <Hand className="size-4 text-cyan-300" />
              Show your hand
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
