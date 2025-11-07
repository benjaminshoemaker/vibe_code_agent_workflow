import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import { env } from "../env";

export const SESSION_COOKIE_NAME = "sid";
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

export function createSessionId() {
  return randomUUID();
}

export function setSessionCookie(reply: FastifyReply, sessionId: string) {
  const expires = new Date(Date.now() + THIRTY_DAYS_SECONDS * 1000);
  reply.setCookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: THIRTY_DAYS_SECONDS,
    expires
  });
}
