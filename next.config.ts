import type { NextConfig } from "next";

const CONTENT_SECURITY_POLICY_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const globalSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Content-Security-Policy-Report-Only",
    value: CONTENT_SECURITY_POLICY_REPORT_ONLY,
  },
];

const viewOnlyReferrerPolicy = [
  { key: "Referrer-Policy", value: "no-referrer" },
];

const manageLinkNoStoreHeaders = [
  {
    key: "Cache-Control",
    value: "private, no-store, max-age=0, must-revalidate",
  },
  { key: "Pragma", value: "no-cache" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Nodemailer — CJS SMTP-стек. Держим external + webpack build: Turbopack
  // serverExternalPackages в standalone даёт require("nodemailer-<hash>") и
  // битые symlink в Docker (MODULE_NOT_FOUND), тогда как mail:test/ops видит
  // реальный package.
  serverExternalPackages: ["nodemailer"],
  outputFileTracingIncludes: {
    "/api/auth/forgot-password": ["./node_modules/nodemailer/**/*"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: globalSecurityHeaders,
      },
      {
        source: "/view/schedule/:path*",
        headers: viewOnlyReferrerPolicy,
      },
      {
        source: "/api/view/schedule/:path*",
        headers: viewOnlyReferrerPolicy,
      },
      // After global headers so Referrer-Policy / Cache-Control override defaults.
      {
        source: "/booking/manage",
        headers: manageLinkNoStoreHeaders,
      },
      {
        source: "/api/booking/manage",
        headers: manageLinkNoStoreHeaders,
      },
      {
        source: "/api/booking/manage/:path*",
        headers: manageLinkNoStoreHeaders,
      },
    ];
  },
};

export default nextConfig;
