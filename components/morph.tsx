// components/morph.tsx
// Client-only: imported from the Studio client boundary (measures the page, animates a fixed overlay).

import { motion } from "framer-motion";
import type { Stroke } from "@/lib/draw";

export type MorphFlight = {
  runId: string;
  strokes: Stroke[];
  /** The camera lens, where stroke points are measured in lens heights. */
  from: DOMRect;
  /** The preview panel the light lands in. */
  to: DOMRect;
};

const FLIGHT_S = 1.05;

/** The drawn light lifts off the lens, flies into the preview panel and dissolves there. */
export function Morph({ flight, onLanded }: { flight: MorphFlight; onLanded: () => void }) {
  const { strokes, from, to } = flight;
  const points = strokes.flat();
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  // A straight line has a zero-size box; pad so the SVG still has an area.
  const w = Math.max(maxX - minX, 0.02);
  const h = Math.max(maxY - minY, 0.02);

  const start = { left: from.left + minX * from.height, top: from.top + minY * from.height, width: w * from.height, height: h * from.height };
  const scale = Math.min((to.width * 0.55) / start.width, (to.height * 0.55) / start.height);
  const dx = to.left + to.width / 2 - (start.left + start.width / 2);
  const dy = to.top + to.height / 2 - (start.top + start.height / 2);

  const d = strokes
    .map((stroke) => `M${stroke.map((p) => `${p.x - minX} ${p.y - minY}`).join(" L")}`)
    .join(" ");

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed z-50"
      style={{ ...start, transformOrigin: "center" }}
      initial={{ x: 0, y: 0, scale: 1, opacity: 1, filter: "blur(0px)" }}
      animate={{
        x: [0, dx * 0.5, dx],
        // A gentle arc: rise a little mid-flight, then settle into the panel.
        y: [0, dy * 0.5 - 60, dy],
        scale: [1, (1 + scale) / 2, scale],
        opacity: [1, 1, 1, 0],
        filter: ["blur(0px)", "blur(0px)", "blur(0px)", "blur(10px)"],
      }}
      transition={{ duration: FLIGHT_S, ease: [0.65, 0, 0.35, 1], times: [0, 0.5, 1], opacity: { duration: FLIGHT_S + 0.35, times: [0, 0.6, 0.75, 1] }, filter: { duration: FLIGHT_S + 0.35, times: [0, 0.6, 0.75, 1] } }}
      onAnimationComplete={onLanded}
    >
      <svg
        viewBox={`${-(w - (maxX - minX)) / 2} ${-(h - (maxY - minY)) / 2} ${w} ${h}`}
        className="size-full overflow-visible drop-shadow-[0_0_10px_rgba(255,166,51,0.95)]"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={d} stroke="rgba(255,181,71,0.9)" strokeWidth={6} vectorEffect="non-scaling-stroke" />
        <path d={d} stroke="rgb(255,249,236)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
    </motion.div>
  );
}
