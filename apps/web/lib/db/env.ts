import { config } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

// Load .env first, then optionally .env.local to override.
const basePath = resolve(process.cwd(), ".env");
const localPath = resolve(process.cwd(), ".env.local");

if (existsSync(basePath)) config({ path: basePath });
if (existsSync(localPath)) config({ path: localPath, override: true });

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Add it to .env (postgres://user:pass@host:5432/db).",
  );
}

export const env = {
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_URL_UNPOOLED:
    process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL,
  NODE_ENV: (process.env.NODE_ENV ?? "development") as
    | "development"
    | "production"
    | "test",
};
