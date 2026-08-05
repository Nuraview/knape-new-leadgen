import { S3Client } from "@aws-sdk/client-s3";

// Make the S3 client lazy — NuraView doesn't use MinIO for lead-management, but
// other NuraviewCRM routes (invoice PDFs, documents) still reference this module.
// Throwing at import time breaks `next build` when env vars aren't set.
// Throwing at first use means the feature fails clearly if invoked without config.

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not defined — set it in .env / Vercel env to use MinIO features`,
    );
  }
  return v;
}

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    endpoint: requireEnv("MINIO_ENDPOINT"),
    region: "us-east-1", // MinIO requires a region value; actual value doesn't matter
    credentials: {
      accessKeyId: requireEnv("MINIO_ACCESS_KEY"),
      secretAccessKey: requireEnv("MINIO_SECRET_KEY"),
    },
    forcePathStyle: true, // REQUIRED for MinIO
  });
  return _client;
}

// Proxy preserves the old `minioClient.send(...)` call sites without change.
export const minioClient = new Proxy({} as S3Client, {
  get(_t, prop) {
    const c = getClient() as any;
    const v = c[prop];
    return typeof v === "function" ? v.bind(c) : v;
  },
});

export const MINIO_BUCKET = process.env.MINIO_BUCKET ?? "";
export const MINIO_PUBLIC_URL = process.env.NEXT_PUBLIC_MINIO_ENDPOINT;
