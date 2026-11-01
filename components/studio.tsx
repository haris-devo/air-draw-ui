// components/studio.tsx
"use client"; // The one client boundary: webcam, canvases, rAF loop, fetch and iframe messaging all live below it.

import { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Code2, Eraser, Eye, Gauge, Hand, PenLine, RotateCcw, Sparkles, Wand2 } from "lucide-react";
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

type Pill = { label: string; tone: "cyan" | "neutral" | "rose" | "amber" | "emerald"; pulse?: boolean };

const TONES: Record<Pill["tone"], string> = {
  cyan: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200 [--dot:var(--color-cyan-400)]",
  neutral: "border-white/10 bg-white/5 text-neutral-300 [--dot:var(--color-neutral-400)]",
  rose: "border-rose-400/30 bg-rose-400/10 text-rose-200 [--dot:var(--color-rose-400)]",
  amber: "border-amber-400/30 bg-amber-400/10 text-amber-200 [--dot:var(--color-amber-400)]",
  emerald: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200 [--dot:var(--color-emerald-400)]",
};

function pillFor(gen: Gen, canvas: CanvasStatus): Pill {
  if (gen.kind === "generating" || gen.kind === "rendering") return { label: "Generating…", tone: "cyan", pulse: true };
  switch (canvas.tracker) {
    case "loading":
      return { label: "Loading hand tracking", tone: "neutral", pulse: true };
    case "denied":
      return { label: "Camera blocked", tone: "rose" };
    case "unavailable":
      return { label: "No camera", tone: "rose" };
    case "off":
      return canvas.drawing ? { label: "Drawing", tone: "cyan" } : { label: "Pen mode", tone: "neutral" };
  }
  if (canvas.drawing) return { label: "Drawing", tone: "cyan" };
  if (!canvas.hand) return { label: "Show your hand", tone: "amber" };
  return { label: "Ready", tone: "emerald" };
}

const LEGEND = [
  { emoji: "☝️", gesture: "Point", action: "draw" },
  { emoji: "✋", gesture: "Palm", action: "clear" },
  { emoji: "✌️", gesture: "Peace", action: "generate" },
];

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
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/10 px-4 py-3 sm:px-6">
        <h1 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-neutral-100">
          <Wand2 className="size-4 text-cyan-300" />
          Air Draw <span className="text-neutral-500">→</span> UI
        </h1>
        <span
          role="status"
          aria-live="polite"
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
            TONES[pill.tone],
          )}
        >
          <span className={cn("size-1.5 rounded-full bg-(--dot)", pill.pulse && "animate-pulse")} />
          {pill.label}
        </span>
        <div role="group" aria-label="Drawing input" className="flex rounded-full border border-white/10 bg-white/3 p-0.5">
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
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors [&_svg]:size-3.5",
                penMode === option.pen ? "bg-white/10 text-neutral-100" : "text-neutral-400 hover:text-neutral-200",
              )}
            >
              {option.icon}
              {option.label}
            </button>
          ))}
        </div>
        <ul className={cn("hidden items-center gap-1.5", !penMode && "md:flex")} aria-label="Gesture legend">
          {LEGEND.map((g) => (
            <li
              key={g.gesture}
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/3 px-2.5 py-1 text-xs text-neutral-400"
            >
              <span aria-hidden>{g.emoji}</span>
              <span className="text-neutral-200">{g.gesture}</span>= {g.action}
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={clear} disabled={busy}>
            <Eraser />
            Clear
          </Button>
          <Button onClick={generate} disabled={busy} className="bg-cyan-400 text-neutral-950 hover:bg-cyan-300">
            <Sparkles />
            Generate
          </Button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 overflow-y-auto lg:overflow-visible grid-rows-[minmax(280px,1fr)_minmax(360px,1fr)] gap-4 p-4 sm:p-6 lg:grid-cols-2 lg:grid-rows-1">
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
          />
        </section>

        <section className="flex min-h-0 flex-col" aria-label="Result">
          <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="min-h-0 flex-1">
            <TabsList>
              <TabsTrigger value="preview">
                <Eye />
                Preview
              </TabsTrigger>
              <TabsTrigger value="code">
                <Code2 />
                Code
              </TabsTrigger>
            </TabsList>
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
    <div className="relative size-full overflow-hidden rounded-xl border border-white/10 bg-neutral-900">
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
          <div className="h-8 w-1/2 rounded-lg bg-white/5" />
          <div className="h-4 w-3/4 rounded bg-white/5" />
          <div className="h-11 rounded-xl bg-white/5" />
          <div className="h-11 rounded-xl bg-white/5" />
          <div className="h-11 w-1/3 rounded-xl bg-cyan-400/10" />
          <p className="mt-auto text-center text-sm text-neutral-400">Turning your sketch into UI…</p>
          <div className="shimmer absolute inset-0" />
        </div>
      )}

      {gen.kind === "idle" && (
        <Empty
          icon={<Sparkles />}
          title="Your component appears here"
          body="Point your index finger and draw a wireframe in the air, then hold ✌️ (or press Generate)."
        />
      )}

      {gen.kind === "rate_limited" && (
        <Empty icon={<Gauge />} title="Slow down, try again in a few minutes" body="Each visitor gets 5 generations every 10 minutes." />
      )}

      {gen.kind === "quota" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <div>
            <p className="text-base font-medium text-neutral-100">Demo quota reached for today</p>
            <p className="mt-1 text-sm text-neutral-400">The demo budget is used up. Here&apos;s what it looks like:</p>
          </div>
          <video
            src="/demo.mp4"
            className="aspect-video w-full max-w-lg rounded-xl border border-white/10 bg-black"
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
          icon={<AlertTriangle className="text-rose-300" />}
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
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center [&>svg]:size-7 [&>svg]:text-neutral-500">
      {icon}
      <p className="mt-1 text-base font-medium text-neutral-100">{title}</p>
      <p className="max-w-sm text-sm break-words text-neutral-400">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
