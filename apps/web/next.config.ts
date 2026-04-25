import { resolve } from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: resolve(__dirname, "../.."),
  eslint: {
    // We use Biome instead of ESLint.
    ignoreDuringBuilds: true,
  },
};

export default config;
