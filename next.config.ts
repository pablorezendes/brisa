import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O navegador de QA local usa 127.0.0.1; sem esta origem o Next bloqueia
  // os recursos de desenvolvimento e os controles client-side não hidratam.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
