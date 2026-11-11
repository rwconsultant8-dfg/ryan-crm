import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["tesseract.js","tesseract.js-core","pdfjs-dist","@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/codex/jobs": ["./lib/assistant/assets/**/*","./node_modules/tesseract.js/**/*","./node_modules/tesseract.js-core/**/*","./node_modules/pdfjs-dist/legacy/build/**/*","./node_modules/pdfjs-dist/cmaps/**/*","./node_modules/pdfjs-dist/standard_fonts/**/*"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
