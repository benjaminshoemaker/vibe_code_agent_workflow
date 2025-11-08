import fp from "fastify-plugin";
import type { FastifyPluginCallback } from "fastify";

function buildCsp(dev: boolean) {
  const scriptSrc = dev ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline'";
  return [
    "default-src 'self'",
    scriptSrc,
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join("; ");
}

const ADDITIONAL_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin"
};

const securityHeadersPlugin: FastifyPluginCallback = (app, _opts, done) => {
  app.addHook("onRequest", (_request, reply, hookDone) => {
    const set = (header: string, value: string) => {
      reply.header(header, value);
      reply.raw.setHeader(header, value);
    };

    const dev = process.env.NODE_ENV !== "production";
    set("Content-Security-Policy", buildCsp(dev));
    set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");

    for (const [header, value] of Object.entries(ADDITIONAL_HEADERS)) {
      set(header, value);
    }

    hookDone();
  });

  done();
};

export default fp(securityHeadersPlugin, {
  name: "security-headers"
});
