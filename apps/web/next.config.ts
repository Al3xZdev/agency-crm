import type { NextConfig } from 'next';

const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:3000';

// Standalone output is required by the production container image but its
// trace-copy step needs symlink privileges that Windows dev hosts lack;
// container builds set WEB_STANDALONE=1 (Linux), local/CI builds skip it.
const nextConfig: NextConfig = {
  ...(process.env.WEB_STANDALONE === '1' ? { output: 'standalone' as const } : {}),
  async rewrites() {
    return [
      // Design §7: same-origin proxying keeps cookies first-party (no CORS).
      { source: '/api/:path*', destination: `${INTERNAL_API_URL}/:path*` },
      { source: '/media/:path*', destination: `${INTERNAL_API_URL}/media/:path*` },
    ];
  },
};

export default nextConfig;
