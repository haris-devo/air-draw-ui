// lib/ratelimit.ts
import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Keep this at or below your Gemini model's free daily request quota.
const DAILY_CAP = Number(process.env.GENERATE_DAILY_CAP) || 400;

export type LimitResult = "ok" | "rate_limited" | "quota" | "misconfigured";

function createLimiters() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const redis = new Redis({ url, token });
  return {
    perIp: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, "10 m"), prefix: "airdraw:ip" }),
    global: new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(DAILY_CAP, "1 d"), prefix: "airdraw:global" }),
  };
}

const limiters = createLimiters();

export async function checkLimits(ip: string): Promise<LimitResult> {
  if (!limiters) {
    // shortcut: local dev runs without Upstash; production refuses to run unlimited.
    return process.env.NODE_ENV === "production" ? "misconfigured" : "ok";
  }
  // Per-IP first, so one noisy visitor can't burn the shared daily budget.
  const ipResult = await limiters.perIp.limit(ip);
  if (!ipResult.success) return "rate_limited";
  const globalResult = await limiters.global.limit("all");
  if (!globalResult.success) return "quota";
  return "ok";
}
