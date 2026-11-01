// app/api/generate/route.ts
import { z } from "zod";
import { cleanCode } from "@/lib/clean-code";
import { checkLimits } from "@/lib/ratelimit";

// Gemini can take a while on a cold, thinking-enabled model; Hobby allows up to 60 s.
export const maxDuration = 60;

const PNG_PREFIX = "data:image/png;base64,";
const MAX_IMAGE_CHARS = 1_500_000;

const Body = z.object({
  image: z
    .string()
    .max(MAX_IMAGE_CHARS)
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
});

const GeminiResponse = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })).optional() })
          .optional(),
      }),
    )
    .optional(),
});

const PROMPT =
  "This is a hand-drawn UI wireframe. Return ONLY a single React function component named App. Use Tailwind classes in a shadcn/ui visual style (neutral palette, rounded-xl, subtle borders, good spacing). Infer the component type (login form, pricing card, profile, dashboard tile, etc.) and use realistic placeholder copy. You may use React.useState for interactivity. No imports, no exports, no markdown fences.";

type GenerateError = "bad_request" | "rate_limited" | "quota" | "upstream" | "empty" | "config";

function fail(status: number, error: GenerateError, message: string) {
  return Response.json({ error, message }, { status });
}

function clientIp(request: Request) {
  // On Vercel, x-forwarded-for is set by the platform, so its first entry is the real client.
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(400, "bad_request", "Body must be JSON.");
  }
  const body = Body.safeParse(json);
  if (!body.success) return fail(400, "bad_request", "Expected { image } as a PNG data URL under 1.5 MB.");

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!apiKey || !model) return fail(500, "config", "The server is missing GEMINI_API_KEY or GEMINI_MODEL.");

  const limit = await checkLimits(clientIp(request));
  if (limit === "rate_limited") return fail(429, "rate_limited", "Slow down, try again in a few minutes.");
  if (limit === "quota") return fail(503, "quota", "Demo quota reached for today.");
  if (limit === "misconfigured") return fail(500, "config", "Rate limiting is not configured on the server.");

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        // Key goes in a header, not the URL, so it never shows up in logs.
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: PROMPT },
                { inline_data: { mime_type: "image/png", data: body.data.image.slice(PNG_PREFIX.length) } },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(55_000),
      },
    );
  } catch {
    return fail(502, "upstream", "Gemini didn't respond in time.");
  }

  if (upstream.status === 429) return fail(503, "quota", "Demo quota reached for today.");
  if (!upstream.ok) return fail(502, "upstream", `Gemini returned an error (${upstream.status}).`);

  const parsed = GeminiResponse.safeParse(await upstream.json().catch(() => null));
  const text =
    parsed.data?.candidates?.[0]?.content?.parts
      ?.filter((part) => !part.thought)
      .map((part) => part.text ?? "")
      .join("") ?? "";
  const code = cleanCode(text);
  if (!code) return fail(502, "empty", "Gemini returned no code. Try drawing it a bit clearer.");

  return Response.json({ code });
}
