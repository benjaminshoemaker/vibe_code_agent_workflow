import fp from "fastify-plugin";
import type { FastifyInstance, FastifyPluginCallback } from "fastify";

type Counter = { count: number; resetAt: number };

class InMemoryRateLimiter {
  private counters = new Map<string, Counter>();
  private activeChat = new Set<string>();

  check(sid: string, bucket: string, limit: number, windowMs: number) {
    const now = Date.now();
    const key = `${sid}:${bucket}`;
    const current = this.counters.get(key);
    if (!current || now >= current.resetAt) {
      this.counters.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true, remaining: limit - 1, retryAfterSec: 0 } as const;
    }
    if (current.count < limit) {
      current.count += 1;
      return { ok: true, remaining: limit - current.count, retryAfterSec: 0 } as const;
    }
    const retryAfterSec = Math.ceil((current.resetAt - now) / 1000);
    return { ok: false, remaining: 0, retryAfterSec } as const;
  }

  acquireChat(sid: string) {
    if (this.activeChat.has(sid)) return false;
    this.activeChat.add(sid);
    return true;
  }

  releaseChat(sid: string) {
    this.activeChat.delete(sid);
  }
}

declare module "fastify" {
  interface FastifyInstance {
    rateLimiter: InMemoryRateLimiter;
  }
}

const rateLimitPlugin: FastifyPluginCallback = (app, _opts, done) => {
  const limiter = new InMemoryRateLimiter();
  app.decorate("rateLimiter", limiter);
  done();
};

export default fp(rateLimitPlugin, { name: "rate-limit" });

