import { ensureLocalSQLiteFile } from "../src/db/local-file";

const dbUrl = process.env.TURSO_DATABASE_URL ?? "file:./.tmp/dev.db";

ensureLocalSQLiteFile(dbUrl);

if (dbUrl.startsWith("file:")) {
  console.log(`Ensured local SQLite file at ${dbUrl.replace(/^file:/, "")}`);
} else {
  console.log("Using remote Turso database; no local file needed.");
}
