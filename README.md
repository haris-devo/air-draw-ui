# Air Draw → UI

Draw a UI wireframe in the air with your finger. Gemini or OpenAI turns the sketch into a working React + Tailwind component that renders live next to your drawing, with code you can copy.

- **Pinch** (thumb + index) to draw
- Hold an **open palm** for 1 s to clear
- Hold a **peace sign** ✌️ for 0.8 s to generate

No webcam? Draw with the mouse or a finger on a touch screen; the Clear and Generate buttons do the same as the gestures.

## How it works

| Piece | Where |
| --- | --- |
| Hand tracking: MediaPipe HandLandmarker (GPU, video mode, 1 hand), fully in the browser | `hooks/use-hand-tracker.ts` |
| Gesture classification (pure, unit-tested): pinch with hysteresis, palm, peace, normalized by palm size | `lib/gestures.ts` |
| Strokes, neon rendering, PNG export (black on white, 768 px, cropped to the drawing) | `hooks/use-strokes.ts`, `lib/draw.ts` |
| Hold-to-trigger gestures with a progress ring | `hooks/use-gesture-hold.ts`, `components/air-canvas.tsx` |
| `POST /api/generate`: zod validation, Upstash rate limits, Gemini or OpenAI via `fetch` | `app/api/generate/route.ts`, `lib/ratelimit.ts` |
| Sandboxed live preview (`sandbox="allow-scripts"`, no same-origin) | `components/preview-frame.tsx` |

The model API key is only read inside the route handler and is sent to the provider in a request header, so it never reaches the browser.

**Limits:** each IP gets 5 generations per 10 minutes, and all visitors share a daily cap (default 400). If the model provider says the quota is used up, the app shows a "Demo quota reached" screen with a demo video (`public/demo.mp4`, currently a placeholder; replace it with your own recording).

## Setup

Requirements: Node 20+ and pnpm.

```bash
pnpm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | What it is |
| --- | --- |
| `OPENAI_API_KEY` | Optional. Your OpenAI API key. When set, OpenAI is used instead of Gemini |
| `OPENAI_MODEL` | Optional. Any OpenAI model with image input (default `gpt-6-astra`) |
| `GEMINI_API_KEY` | Your Gemini API key (see below). Not needed when `OPENAI_API_KEY` is set |
| `GEMINI_MODEL` | Any Gemini model with image input, e.g. `gemini-3.8-flash` |
| `UPSTASH_REDIS_REST_URL` | REST URL of your Upstash Redis database |
| `UPSTASH_REDIS_REST_TOKEN` | REST token of the same database |
| `GENERATE_DAILY_CAP` | Optional. Total generations per day across all visitors (default `400`) |

Then:

```bash
pnpm dev
```

Open http://localhost:3000 and allow the camera. In local development the rate limiter is skipped when the Upstash variables are missing. In production they are required.

### Get a free Gemini API key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey) and sign in with a Google account.
2. Click **Create API key** and copy it into `GEMINI_API_KEY`.
3. Check the model's free limits on the [rate limits page](https://ai.google.dev/gemini-api/docs/rate-limits) or in AI Studio. Free-tier quotas differ a lot between models (the Flash models allow far fewer requests per day than Flash-Lite), so set `GENERATE_DAILY_CAP` at or below your model's daily request limit.

### Get a free Upstash Redis database

1. Sign up at [console.upstash.com](https://console.upstash.com).
2. Create a **Redis** database (the free plan is enough) in a region close to your Vercel functions.
3. On the database page, open the **REST API** section and copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

## Deploy to Vercel (Hobby)

1. Push this repository to GitHub.
2. In Vercel, click **Add New → Project** and import the repository. The Next.js preset needs no changes.
3. Under **Environment Variables**, add `OPENAI_API_KEY` (or `GEMINI_API_KEY` and `GEMINI_MODEL`), `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (and `GENERATE_DAILY_CAP` if you want a different cap).
4. Deploy. The camera only works over HTTPS, which Vercel provides.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` | Production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm test` | Unit tests (gestures, code cleanup, route handler error mapping) |

## Tech

Next.js (App Router) · TypeScript strict · Tailwind CSS · shadcn/ui · MediaPipe Tasks Vision · Gemini / OpenAI API · Upstash Ratelimit · zod · Framer Motion
