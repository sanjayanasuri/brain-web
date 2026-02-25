const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ESLint: ignore during builds for fix-loop (we catch runtime errors via Playwright)
  // Run `npm run lint` separately to check linting
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    // !! WARN !!
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors.
    // ignoreBuildErrors: false, // Keep this false to catch type errors
  },
  // Performance optimizations
  swcMinify: true,
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },
  // Experimental features for faster compilation
  experimental: {
    // Enable faster refresh
    optimizePackageImports: [
      '@tanstack/react-query',
      '@tiptap/react',
      '@tiptap/starter-kit',
      'react-force-graph-2d',
      'react-force-graph-3d',
      'd3-force',
    ],
  },
  // Allow loading external modules for graph visualization
  webpack: (config, { dev, isServer }) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
    };

    // Custom optimization removed due to module loading issues
    if (dev && !isServer) {
      // Keep default Next.js optimization for stability
    }

    return config;
  },
  // Caching headers
  async headers() {
    return [
      {
        source: '/(.*).(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|otf)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
        ],
      },
    ];
  },
};

module.exports = withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
}, {
  // Hide source maps from client bundles while still uploading when auth token is set.
  hideSourceMaps: true,
  disableLogger: true,
});
