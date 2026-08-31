import path from "node:path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// The Next project root is `frontend/`, but `@verifystack/backend` source lives
// one level up. Turbopack refuses to resolve files above its root, so point it
// at the workspace root.
const workspaceRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist", "@react-pdf/renderer", "pdf-lib"],
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    root: workspaceRoot,
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  widenClientFileUpload: false,
  telemetry: false,
});
