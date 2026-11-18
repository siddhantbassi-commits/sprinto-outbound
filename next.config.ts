import type { NextConfig } from "next";

const config: NextConfig = {
  // A second dev server (the demo, on its own port) needs its own build folder, or the two lock each other out.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The demo database is a WebAssembly Postgres; keep it out of the bundle and load it from node_modules.
  serverExternalPackages: ["@electric-sql/pglite"],
  // A deployment that runs the demo needs the database's WebAssembly files shipped with its functions; the real one does not.
  ...(process.env.DEMO_MODE === "1" ? { outputFileTracingIncludes: { "/**": ["./node_modules/@electric-sql/pglite/dist/**/*"] } } : {}),
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default config;
