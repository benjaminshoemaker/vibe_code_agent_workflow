import { config as loadEnvFile } from "dotenv";
import { z } from "zod";

const preLoadedKeys = new Set(Object.keys(process.env));

loadEnvFile({ path: ".env", quiet: true });
const localResult = loadEnvFile({ path: ".env.local", quiet: true });

if (localResult.parsed) {
  for (const [key, value] of Object.entries(localResult.parsed)) {
    if (preLoadedKeys.has(key)) {
      continue;
    }
    process.env[key] = value;
  }
}

const emptyToUndefined = (value: unknown) => {
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }
  return value;
};

const optionalString = () => z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalUrl = () => z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalBoolean = () =>
  z.preprocess((value) => {
    const normalized = emptyToUndefined(value);
    if (normalized === undefined) return undefined;
    if (typeof normalized === "boolean") return normalized;
    if (typeof normalized === "string") {
      if (normalized.toLowerCase() === "true") return true;
      if (normalized.toLowerCase() === "false") return false;
    }
    return normalized;
  }, z.boolean().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: optionalString(),
  PORT: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === "") {
        return 3000;
      }

      const parsed = Number(value);
      if (Number.isNaN(parsed) || parsed <= 0) {
        throw new Error("PORT must be a positive number");
      }
      return parsed;
    }),
  OPENAI_API_KEY: optionalString(),
  OPENAI_API_BASE: optionalUrl(),
  OPENAI_MODEL: optionalString(),
  TURSO_DATABASE_URL: optionalUrl(),
  TURSO_AUTH_TOKEN: optionalString(),
  SESSION_COOKIE_SECURE: optionalBoolean()
});

export type AppEnv = z.infer<typeof envSchema>;

export const env = loadEnv(process.env);

export function loadEnv(source: NodeJS.ProcessEnv): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }

  return {
    ...parsed.data,
    PORT: parsed.data.PORT ?? 3000,
    OPENAI_MODEL: parsed.data.OPENAI_MODEL ?? "gpt-4o-mini",
    HOST: parsed.data.HOST?.trim() || undefined
  };
}
