import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "../env";
import * as schema from "./schema";
import { ensureLocalSQLiteFile } from "./local-file";

const tursoUrl = env.TURSO_DATABASE_URL ?? "file:./.tmp/dev.db";
const tursoToken = env.TURSO_AUTH_TOKEN;

ensureLocalSQLiteFile(tursoUrl);

export const libsql = createClient({
  url: tursoUrl,
  authToken: tursoToken
});

export type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>;

export const db = drizzle(libsql, { schema });
