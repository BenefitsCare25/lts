import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Standalone output is only needed for the production container image
// (see ../../Dockerfile). It's gated on STANDALONE_BUILD=true so that
// local Windows dev builds don't trip the EPERM-on-symlink limitation
// that standalone tracing hits without Developer Mode.
const standalone = process.env.STANDALONE_BUILD === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  ...(standalone
    ? {
        output: 'standalone',
        // The trace root must be a real OS path, not a URL pathname
        // (the URL form produces "/C:/..." on Windows which Next
        // interprets as a top-level "C:" directory).
        outputFileTracingRoot: resolve(here, '../..'),
      }
    : {}),
};

export default nextConfig;
