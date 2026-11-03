import path from "node:path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// The Next project root is `frontend/`, but `@verifystack/backend` source lives
// one level up. Turbopack refuses to resolve files above its root, so point it
// at the workspace root.
const workspaceRoot = path.join(__dirname, "..");

const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Invite links carry their token in the query string; never send it to another origin.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist", "@react-pdf/renderer", "pdf-lib"],
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
  experimental: {
    // The proxy buffers request bodies and silently truncates past this limit.
    // It must exceed the 50 MB evidence cap or uploads are stored cut short.
    proxyClientMaxBodySize: "52mb",
    // Keep a short client-router cache for dynamic Server Component navigations
    // so switching back to a tab you just left feels instant. Mutations still
    // call router.refresh() and replace the cache for that route.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  widenClientFileUpload: false,
  telemetry: false,
});
