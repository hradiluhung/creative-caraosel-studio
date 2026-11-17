import type { NextConfig } from "next";

/**
 * Security headers for every response (served by `next start` and by hosts that run Next, such as
 * Vercel; a plain static file host needs the same headers configured there).
 *
 * The app talks to no other origin: everything is same-origin, or a blob / data URL made from
 * files the user picked. The policy says exactly that, so a bug cannot load or send anything
 * elsewhere. 'unsafe-inline' is needed for the inline scripts and styles Next and Konva emit on
 * prerendered pages (a nonce would force every page to render on the server), 'wasm-unsafe-eval'
 * for the AAC encoder used by video export. Development also needs 'unsafe-eval' (React refresh).
 */
const dev = process.env.NODE_ENV !== "production";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob: data:",
  "font-src 'self' blob: data:",
  `connect-src 'self' blob: data:${dev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Nothing in the app uses these device features.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
