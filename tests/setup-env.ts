import path from "node:path";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/libsql/migrator";

const poolId = process.env.VITEST_POOL_ID ?? `${process.pid}`;
const testDbPath = path.resolve(process.cwd(), `.tmp/test-${poolId}-${randomUUID()}.db`);

process.env.TURSO_DATABASE_URL = `file:${testDbPath}`;
process.env.OPENAI_API_KEY ??= "test-openai-key";

const { db } = await import("../src/db/client");
await migrate(db, { migrationsFolder: "./drizzle/migrations" });
