// app/api/generate/route.ts
import { z } from "zod";
import { cleanCode } from "@/lib/clean-code";
import { checkLimits } from "@/lib/ratelimit";

// Thinking-enabled models can take a while on a cold start; Hobby allows up to 60 s.
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

const OpenAIResponse = z.object({
  output: z
    .array(
      z.object({
        type: z.string(),
        content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
      }),
    )
    .optional(),
});

const PROMPT =
  "This is a hand-drawn UI wireframe. Return ONLY a single React function component named App. Use Tailwind classes in a shadcn/ui visual style (neutral palette, rounded-xl, subtle borders, good spacing). Infer the component type (login form, pricing card, profile, dashboard tile, etc.) and use realistic placeholder copy. You may use React.useState for interactivity. It sits centered on a design canvas, so give it no page background, min-h-screen or outer wrapper. No imports, no exports, no markdown fences.";

type Provider = {
  name: string;
  url: string;
  headers: Record<string, string>;
  body: (image: string) => unknown;
  text: (json: unknown) => string;
};

function pickProvider(): Provider | null {
  // OpenAI wins when its key is set, so a paid key can take over without removing the Gemini one.
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const model = process.env.OPENAI_MODEL || "gpt-6-astra";
    return {
      name: "OpenAI",
      url: "https://api.openai.com/v1/responses",
      headers: { authorization: `Bearer ${openaiKey}` },
      body: (image) => ({
        model,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: PROMPT },
              { type: "input_image", image_url: image },
            ],
          },
        ],
      }),
      // Reasoning items carry no message content, so only output_text parts of messages are kept.
      text: (json) =>
        OpenAIResponse.safeParse(json)
          .data?.output?.filter((item) => item.type === "message")
          .flatMap((item) => item.content ?? [])
          .filter((part) => part.type === "output_text")
          .map((part) => part.text ?? "")
          .join("") ?? "",
    };
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!geminiKey || !model) return null;
  return {
    name: "Gemini",
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    // Key goes in a header, not the URL, so it never shows up in logs.
    headers: { "x-goog-api-key": geminiKey },
    body: (image) => ({
      contents: [
        {
          parts: [{ text: PROMPT }, { inline_data: { mime_type: "image/png", data: image.slice(PNG_PREFIX.length) } }],
        },
      ],
    }),
    text: (json) =>
      GeminiResponse.safeParse(json)
        .data?.candidates?.[0]?.content?.parts?.filter((part) => !part.thought)
        .map((part) => part.text ?? "")
        .join("") ?? "",
  };
}

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

  const provider = pickProvider();
  if (!provider) return fail(500, "config", "The server needs OPENAI_API_KEY, or GEMINI_API_KEY and GEMINI_MODEL.");

  const limit = await checkLimits(clientIp(request));
  if (limit === "rate_limited") return fail(429, "rate_limited", "Slow down, try again in a few minutes.");
  if (limit === "quota") return fail(503, "quota", "Demo quota reached for today.");
  if (limit === "misconfigured") return fail(500, "config", "Rate limiting is not configured on the server.");

  let upstream: Response;
  try {
    upstream = await fetch(provider.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...provider.headers },
      body: JSON.stringify(provider.body(body.data.image)),
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    return fail(502, "upstream", `${provider.name} didn't respond in time.`);
  }

  // Both providers use 429 for rate limits and for an exhausted quota or billing balance.
  if (upstream.status === 429) return fail(503, "quota", "Demo quota reached for today.");
  if (!upstream.ok) return fail(502, "upstream", `${provider.name} returned an error (${upstream.status}).`);

  const code = cleanCode(provider.text(await upstream.json().catch(() => null)));
  if (!code) return fail(502, "empty", `${provider.name} returned no code. Try drawing it a bit clearer.`);

  return Response.json({ code });
}
