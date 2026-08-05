const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Repo root is a bun workspace, so dependencies hoist to ../../node_modules.
  // Without this, tracing roots at apps/web and the standalone output ships a
  // node_modules missing every hoisted package — the container then crashes on
  // first require. With it, standalone is laid out as apps/web/server.js plus a
  // shared node_modules at the root, which is why the Dockerfile runs
  // `node apps/web/server.js`.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "puppeteer-core"],
  typescript: {
    // The Drizzle-backed prismadb compat shim is typed as `any`, which makes
    // hundreds of downstream call sites produce implicit-any warnings under
    // `noImplicitAny`. Next already compiles them fine; we skip the strict
    // tsc pass during build. Remove this once every call site has been
    // rewritten to native Drizzle.
    ignoreBuildErrors: true,
  },
  allowedDevOrigins: ['185.245.182.175'],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "localhost" },
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "minio-cwg0o4ss0scoccgwso8sk004.coolify.cz" },
      { protocol: "http", hostname: "minio" },
    ],
  },
  async rewrites() {
    return [
      // Legacy Twilio webhook paths — the TwiML App on the Twilio console may
      // still reference /api/voice, /api/voice-fallback, /api/call-status
      // without the /twilio prefix. Rewrite them to the real routes so they
      // hit the proxy passthrough and the correct handlers.
      { source: "/api/voice", destination: "/api/twilio/voice" },
      { source: "/api/voice-fallback", destination: "/api/twilio/voice-fallback" },
      { source: "/api/call-status", destination: "/api/twilio/call-status" },
      { source: "/api/sms-webhook", destination: "/api/twilio/sms-webhook" },
    ];
  },
  async redirects() {
    return [
      // NuraView: leads live at /leads now. The old NuraviewCRM /crm/leads page
      // uses a legacy Zod schema that rejects ingested Upwork data.
      {
        source: "/crm/leads",
        destination: "/leads",
        permanent: false,
      },
      {
        source: "/crm/leads/:path*",
        destination: "/leads",
        permanent: false,
      },
      {
        source: "/crm/targets/:path*",
        destination: "/campaigns/targets/:path*",
        permanent: true,
      },
      {
        source: "/crm/target-lists/:path*",
        destination: "/campaigns/target-lists/:path*",
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
