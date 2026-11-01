// lib/draw.ts
// Points are stored in "height units": y in [0, 1], x in [0, aspect].
// That keeps shapes undistorted across resizes and lets export ignore the canvas size.

export type Point = { x: number; y: number };
export type Stroke = Point[];

/** Traces a stroke as quadratic curves through segment midpoints (smooth, no corners). */
export function traceStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  scale: number,
  offset: Point = { x: 0, y: 0 },
) {
  const px = (p: Point) => [(p.x - offset.x) * scale, (p.y - offset.y) * scale] as const;
  ctx.beginPath();
  const [x0, y0] = px(stroke[0]);
  ctx.moveTo(x0, y0);
  if (stroke.length === 1) {
    // A single point still needs a visible dot.
    ctx.lineTo(x0 + 0.01, y0);
    return;
  }
  for (let i = 1; i < stroke.length - 1; i++) {
    const [cx, cy] = px(stroke[i]);
    const [nx, ny] = px(stroke[i + 1]);
    ctx.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
  }
  const [lx, ly] = px(stroke[stroke.length - 1]);
  ctx.lineTo(lx, ly);
}

/** Neon look: a blurred cyan glow pass, then a bright thin core. */
export function drawNeonStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, scale: number, dpr: number) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  traceStroke(ctx, stroke, scale);
  ctx.shadowColor = "rgba(34, 211, 238, 0.9)";
  ctx.shadowBlur = 18 * dpr;
  ctx.strokeStyle = "rgba(34, 211, 238, 0.85)";
  ctx.lineWidth = 6 * dpr;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(236, 254, 255, 0.95)";
  ctx.lineWidth = 2 * dpr;
  ctx.stroke();
  ctx.restore();
}

const EXPORT_SIZE = 768;
const EXPORT_PADDING = 32;
const EXPORT_LINE = 6;

/** Renders strokes only, black on white, cropped to their bounding box; returns a PNG data URL. */
export function exportStrokesPng(strokes: Stroke[]): string | null {
  const points = strokes.flat();
  if (points.length === 0) return null;
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  // Guard against a single dot or a perfectly straight line (zero-size box).
  const w = Math.max(maxX - minX, 0.05);
  const h = Math.max(maxY - minY, 0.05);
  const inner = EXPORT_SIZE - EXPORT_PADDING * 2;
  const scale = inner / Math.max(w, h);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale + EXPORT_PADDING * 2);
  canvas.height = Math.round(h * scale + EXPORT_PADDING * 2);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(EXPORT_PADDING, EXPORT_PADDING);
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = EXPORT_LINE;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Center the drawing when the box was widened by the guard above.
  const origin = { x: minX - (w - (maxX - minX)) / 2, y: minY - (h - (maxY - minY)) / 2 };
  for (const stroke of strokes) {
    traceStroke(ctx, stroke, scale, origin);
    ctx.stroke();
  }
  return canvas.toDataURL("image/png");
}
