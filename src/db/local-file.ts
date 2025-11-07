import fs from "node:fs";
import path from "node:path";

export function ensureLocalSQLiteFile(url: string) {
  if (!url.startsWith("file:")) {
    return;
  }

  const relativePath = url.replace(/^file:/, "");
  const resolvedPath = path.isAbsolute(relativePath)
    ? relativePath
    : path.resolve(process.cwd(), relativePath);

  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(resolvedPath)) {
    fs.closeSync(fs.openSync(resolvedPath, "a"));
  }
}
