// components/studio.tsx
"use client"; // The one client boundary: webcam, canvases, rAF loop, fetch and iframe messaging all live below it.

import { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Code2, Eraser, Eye, Gauge, Hand, PenLine, RotateCcw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AirCanvas, type CanvasStatus } from "@/components/air-canvas";
import { CodeView } from "@/components/code-view";
import { PreviewFrame } from "@/components/preview-frame";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStrokes } from "@/hooks/use-strokes";
import { exportStrokesPng } from "@/lib/draw";
import { cn } from "@/lib/utils";

type Gen =
  | { kind: "idle" }
  | { kind: "generating" }
  | { kind: "rendering" | "success"; code: string; runId: string; autoRetried: boolean }
  | { kind: "render_error"; message: string }
  | { kind: "rate_limited" }
  | { kind: "quota" }
  | { kind: "error"; message: string };

type Pill = { label: string; tone: "light" | "ready" | "idle" | "alert"; pulse?: boolean };

// Dot colors for the status chip that sits on the dark camera lens.
const DOTS: Record<Pill["tone"], string> = {
  light: "bg-sodium shadow-[0_0_10px_var(--color-sodium)]",
  ready: "bg-emerald-400",
  idle: "bg-white/50",
  alert: "bg-rose-400",
};

function pillFor(gen: Gen, canvas: CanvasStatus): Pill {
  if (gen.kind === "generating" || gen.kind === "rendering") return { label: "Generating", tone: "light", pulse: true };
  switch (canvas.tracker) {
    case "loading":
      return { label: "Loading hand tracking", tone: "idle", pulse: true };
    case "denied":
      return { label: "Camera blocked", tone: "alert" };
    case "unavailable":
      return { label: "No camera", tone: "alert" };
    case "off":
      return canvas.drawing ? { label: "Drawing", tone: "light" } : { label: "Pen mode", tone: "idle" };
  }
  if (canvas.drawing) return { label: "Drawing", tone: "light" };
  if (!canvas.hand) return { label: "Show your hand", tone: "idle", pulse: true };
  return { label: "Ready", tone: "ready" };
}

const LEGEND = [
  { emoji: "☝️", gesture: "Point", action: "to draw" },
  { emoji: "✋", gesture: "Palm", action: "to clear" },
  { emoji: "✌️", gesture: "Peace", action: "to generate" },
];

const PEN_LEGEND = [{ emoji: "✍️", gesture: "Drag", action: "with a pen, mouse or finger" }];

export function Studio() {
  const strokes = useStrokes();
  const [gen, setGen] = useState<Gen>({ kind: "idle" });
  const [code, setCode] = useState("");
  const [tab, setTab] = useState<string>("preview");
  const [penMode, setPenMode] = useState(false);
  const [canvas, setCanvas] = useState<CanvasStatus>({ tracker: "loading", hand: false, drawing: false });
  const lastImage = useRef<string | null>(null);
  const busy = gen.kind === "generating" || gen.kind === "rendering";
  const busyRef = useRef(false);

  const run = useCallback(async (image: string, autoRetry: boolean) => {
    busyRef.current = true;
    setGen({ kind: "generating" });
    setTab("preview");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const data: { code?: string; message?: string } = await res.json().catch(() => ({}));
      if (res.ok && data.code) {
        setCode(data.code);
        setGen({ kind: "rendering", code: data.code, runId: crypto.randomUUID(), autoRetried: autoRetry });
        return;
      }
      busyRef.current = false;
      if (res.status === 429) setGen({ kind: "rate_limited" });
      else if (res.status === 503) setGen({ kind: "quota" });
      else setGen({ kind: "error", message: data.message ?? `Something went wrong (${res.status}).` });
    } catch {
      busyRef.current = false;
      setGen({ kind: "error", message: "Couldn't reach the server. Check your connection." });
    }
  }, []);

  const generate = useCallback(() => {
    if (busyRef.current) return;
    const image = exportStrokesPng(strokes.all());
    if (!image) {
      toast("Draw something first", { description: "Point your index finger to draw, or switch to Pen mode." });
      return;
    }
    lastImage.current = image;
    void run(image, false);
  }, [run, strokes]);

  const retry = () => {
    if (lastImage.current && !busyRef.current) void run(lastImage.current, false);
  };

  const clear = useCallback(() => {
    if (busyRef.current) return;
    strokes.clear();
  }, [strokes]);

  const onPreviewResult = (result: { ok: true } | { ok: false; message: string }) => {
    if (gen.kind === "success" && !result.ok) {
      // It rendered, then crashed (e.g. in an effect): the preview is blank now, so say so.
      setGen({ kind: "render_error", message: result.message });
      return;
    }
    if (gen.kind !== "rendering") return;
    if (result.ok) {
      busyRef.current = false;
      setGen({ ...gen, kind: "success" });
    } else if (!gen.autoRetried && lastImage.current) {
      // First failure: quietly ask the model again before bothering the user.
      void run(lastImage.current, true);
    } else {
      busyRef.current = false;
      setGen({ kind: "render_error", message: result.message });
    }
  };

  const pill = pillFor(gen, canvas);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-4 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
        <h1 className="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight">
          <span aria-hidden className="relative grid size-7 place-items-center rounded-full bg-lens">
            <span className="size-2 rounded-full bg-[#fff4de] shadow-[0_0_8px_2px_var(--color-sodium)]" />
          </span>
          Air Draw
          <span className="font-normal text-muted-foreground">to UI</span>
        </h1>
        <div
          role="group"
          aria-label="Drawing input"
          className="ml-auto flex rounded-full bg-white p-1 shadow-[0_1px_2px_rgba(21,26,46,0.06)] ring-1 ring-border"
        >
          {[
            { pen: false, label: "Hand", icon: <Hand /> },
            { pen: true, label: "Pen", icon: <PenLine /> },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={penMode === option.pen}
              onClick={() => setPenMode(option.pen)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5",
                penMode === option.pen ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.icon}
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-rows-[min(56vw,70vh)_minmax(420px,1fr)] gap-4 overflow-y-auto px-4 pb-4 sm:gap-5 sm:px-6 sm:pb-6 lg:grid-cols-[1.45fr_1fr] lg:grid-rows-1 lg:overflow-visible">
        <section className="min-h-0" aria-label="Drawing">
          <AirCanvas
            strokes={strokes}
            frozen={busy}
            pulsing={busy}
            penMode={penMode}
            onUsePen={() => setPenMode(true)}
            onGenerate={generate}
            onClear={clear}
            onStatusChange={setCanvas}
          >
            <span
              role="status"
              aria-live="polite"
              className="pointer-events-none absolute top-4 left-4 inline-flex items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 text-xs font-medium text-white/90 ring-1 ring-white/10 backdrop-blur-md"
            >
              <span className={cn("size-1.5 rounded-full", DOTS[pill.tone], pill.pulse && "animate-pulse")} />
              {pill.label}
            </span>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 sm:p-4">
              <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-black/45 p-1.5 ring-1 ring-white/10 backdrop-blur-md">
                <ul className="hidden items-center gap-3 px-3 text-xs text-white/55 sm:flex" aria-label="Gesture guide">
                  {(penMode ? PEN_LEGEND : LEGEND).map((g) => (
                    <li key={g.gesture} className="flex items-center gap-1.5">
                      <span aria-hidden>{g.emoji}</span>
                      <span className="text-white/90">{g.gesture}</span>
                      {g.action}
                    </li>
                  ))}
                </ul>
                <span aria-hidden className="mx-1 hidden h-5 w-px bg-white/15 sm:block" />
                <button
                  type="button"
                  onClick={clear}
                  disabled={busy}
                  className="flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium text-white/80 transition-colors outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-40 [&_svg]:size-4"
                >
                  <Eraser />
                  Clear
                </button>
                <button
                  type="button"
                  onClick={generate}
                  disabled={busy}
                  className="flex h-9 items-center gap-1.5 rounded-full bg-sodium px-4 text-[13px] font-semibold text-lens shadow-[0_0_24px_-4px_var(--color-sodium)] transition-[filter,box-shadow] outline-none hover:brightness-105 hover:shadow-[0_0_32px_-2px_var(--color-sodium)] focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50 [&_svg]:size-4"
                >
                  <Sparkles />
                  Generate
                </button>
              </div>
            </div>
          </AirCanvas>
        </section>

        <section
          className="flex min-h-0 flex-col overflow-hidden rounded-[22px] bg-card shadow-[0_1px_2px_rgba(21,26,46,0.05),0_24px_60px_-36px_rgba(21,26,46,0.35)] ring-1 ring-border"
          aria-label="Result"
        >
          <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="min-h-0 flex-1 gap-0">
            <div className="flex items-center gap-3 border-b border-border px-3 py-2.5">
              <TabsList className="h-9 rounded-full p-1">
                <TabsTrigger value="preview" className="rounded-full px-3 data-active:shadow-sm">
                  <Eye />
                  Preview
                </TabsTrigger>
                <TabsTrigger value="code" className="rounded-full px-3 data-active:shadow-sm">
                  <Code2 />
                  Code
                </TabsTrigger>
              </TabsList>
              <p className="ml-auto truncate pr-1 text-xs text-muted-foreground">React + Tailwind</p>
            </div>
            <TabsContent value="preview" keepMounted className="relative min-h-0">
              <PreviewPanel gen={gen} onRetry={retry} onPreviewResult={onPreviewResult} />
            </TabsContent>
            <TabsContent value="code" className="relative min-h-0">
              {code ? (
                <CodeView code={code} />
              ) : (
                <Empty icon={<Code2 />} title="No code yet" body="Generate a component and its source shows up here." />
              )}
            </TabsContent>
          </Tabs>
        </section>
      </main>
    </div>
  );
}

function PreviewPanel({
  gen,
  onRetry,
  onPreviewResult,
}: {
  gen: Gen;
  onRetry: () => void;
  onPreviewResult: (result: { ok: true } | { ok: false; message: string }) => void;
}) {
  const shimmer = gen.kind === "generating" || gen.kind === "rendering";
  return (
    <div className="canvas-grid relative size-full overflow-hidden">
      {(gen.kind === "rendering" || gen.kind === "success") && (
        <motion.div
          key={gen.runId}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={gen.kind === "success" ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 260, damping: 26 }}
        >
          <PreviewFrame code={gen.code} runId={gen.runId} onResult={onPreviewResult} />
        </motion.div>
      )}

      {shimmer && (
        <div className="absolute inset-0 flex flex-col gap-4 p-8">
          <div className="m-auto flex w-full max-w-sm flex-col gap-3 rounded-2xl bg-white/80 p-6 ring-1 ring-border">
            <div className="h-6 w-1/2 rounded-md bg-foreground/8" />
            <div className="h-3.5 w-3/4 rounded bg-foreground/6" />
            <div className="mt-2 h-10 rounded-lg bg-foreground/5" />
            <div className="h-10 rounded-lg bg-foreground/5" />
            <div className="h-10 w-2/5 rounded-lg bg-sodium/40" />
          </div>
          <p className="text-center text-sm text-muted-foreground">Turning your sketch into UI…</p>
          <div className="shimmer absolute inset-0" />
        </div>
      )}

      {gen.kind === "idle" && (
        <Empty
          icon={<SketchHint />}
          title="Your component lands here"
          body="Sketch a login form, a pricing card or a profile in the air, then hold ✌️ or press Generate."
        />
      )}

      {gen.kind === "rate_limited" && (
        <Empty icon={<Gauge />} title="Slow down, try again in a few minutes" body="Each visitor gets 5 generations every 10 minutes." />
      )}

      {gen.kind === "quota" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <div>
            <p className="text-base font-medium">Demo quota reached for today</p>
            <p className="mt-1 text-sm text-muted-foreground">The demo budget is used up. Here&apos;s what it looks like:</p>
          </div>
          <video
            src="/demo.mp4"
            className="aspect-video w-full max-w-lg rounded-xl bg-lens ring-1 ring-border"
            autoPlay
            muted
            loop
            playsInline
            controls
          />
        </div>
      )}

      {(gen.kind === "render_error" || gen.kind === "error") && (
        <Empty
          icon={<AlertTriangle className="text-destructive" />}
          title={gen.kind === "render_error" ? "The generated component didn't render" : "Generation failed"}
          body={gen.message}
          action={
            <Button variant="outline" onClick={onRetry}>
              <RotateCcw />
              Retry
            </Button>
          }
        />
      )}
    </div>
  );
}

function Empty({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center [&>svg]:size-7 [&>svg]:text-muted-foreground">
      {icon}
      <p className="mt-2 text-base font-medium text-foreground">{title}</p>
      <p className="max-w-xs text-sm text-balance break-words text-muted-foreground">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** A dashed wireframe of a small form: what a sketch looks like before it becomes UI. */
function SketchHint() {
  return (
    <svg
      viewBox="0 0 120 92"
      aria-hidden
      className="mb-1 !h-auto !w-28 fill-none stroke-[#b9c0cf] [stroke-dasharray:4_4] [stroke-linecap:round] [stroke-width:1.5]"
    >
      <rect x="2" y="2" width="116" height="88" rx="10" />
      <path d="M16 20h44" />
      <rect x="16" y="32" width="88" height="14" rx="4" />
      <rect x="16" y="52" width="88" height="14" rx="4" />
      <rect x="16" y="72" width="36" height="10" rx="4" className="fill-sodium/25 stroke-sodium [stroke-dasharray:none]" />
    </svg>
  );
}
