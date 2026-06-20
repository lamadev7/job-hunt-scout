import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native/worker-loading packages out of the server bundle so they
  // resolve from node_modules at runtime (fixes pdf.js fake-worker error).
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@prisma/client", "prisma"],
};

export default nextConfig;
