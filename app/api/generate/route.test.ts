// app/api/generate/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const checkLimits = vi.fn();
vi.mock("@/lib/ratelimit", () => ({ checkLimits: (ip: string) => checkLimits(ip) }));

const { POST } = await import("./route");

const PNG = "data:image/png;base64,iVBORw0KGgo=";

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function gemini(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

const textReply = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("GEMINI_MODEL", "gemini-test");
  checkLimits.mockResolvedValue("ok");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  checkLimits.mockReset();
});

describe("POST /api/generate", () => {
  it("rejects non-JSON, wrong type, non-PNG and oversized images with 400", async () => {
    vi.stubGlobal("fetch", gemini(200, textReply("x")));
    expect((await post("not json")).status).toBe(400);
    expect((await post({ image: 42 })).status).toBe(400);
    expect((await post({ image: "data:image/jpeg;base64,AAAA" })).status).toBe(400);
    expect((await post({ image: "data:image/png;base64,<script>" })).status).toBe(400);
    expect((await post({ image: PNG + "A".repeat(1_500_000) })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(checkLimits).not.toHaveBeenCalled();
  });

  it("maps the per-IP limit to 429 rate_limited", async () => {
    checkLimits.mockResolvedValue("rate_limited");
    const res = await post({ image: PNG }, { "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "rate_limited" });
    expect(checkLimits).toHaveBeenCalledWith("203.0.113.7");
  });

  it("maps the global cap and Gemini 429 to 503 quota", async () => {
    checkLimits.mockResolvedValue("quota");
    expect((await post({ image: PNG })).status).toBe(503);

    checkLimits.mockResolvedValue("ok");
    vi.stubGlobal("fetch", gemini(429, { error: { code: 429 } }));
    const res = await post({ image: PNG });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "quota" });
  });

  it("maps other upstream failures to 502", async () => {
    vi.stubGlobal("fetch", gemini(500, {}));
    expect(await (await post({ image: PNG })).json()).toMatchObject({ error: "upstream" });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    const res = await post({ image: PNG });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "upstream" });
  });

  it("returns 502 empty when the model sends nothing usable", async () => {
    vi.stubGlobal("fetch", gemini(200, textReply("```jsx\n```")));
    const res = await post({ image: PNG });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "empty" });

    vi.stubGlobal("fetch", gemini(200, { promptFeedback: { blockReason: "SAFETY" } }));
    expect(await (await post({ image: PNG })).json()).toMatchObject({ error: "empty" });
  });

  it("returns cleaned code, skips thought parts, keeps the key out of the URL", async () => {
    const fetchMock = gemini(200, {
      candidates: [
        {
          content: {
            parts: [
              { text: "thinking about it", thought: true },
              { text: "```jsx\nfunction App() { return <div />; }\n```" },
            ],
          },
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await post({ image: PNG });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: "function App() { return <div />; }" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    expect(url).not.toContain("test-key");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    const sent = JSON.parse(init.body as string);
    expect(sent.contents[0].parts[1].inline_data).toEqual({ mime_type: "image/png", data: "iVBORw0KGgo=" });
  });

  it("returns 500 config when env vars are missing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect((await post({ image: PNG })).status).toBe(500);
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    checkLimits.mockResolvedValue("misconfigured");
    expect((await post({ image: PNG })).status).toBe(500);
  });
});
