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

    // Optimize for faster dev compilation
    if (dev && !isServer) {
      // Reduce chunk size for faster compilation
      // Note: Keep default and vendors enabled to avoid 404s for required chunks
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            // Keep default and vendors enabled for Next.js compatibility
            default: {
              minChunks: 2,
              priority: -20,
              reuseExistingChunk: true,
            },
            vendors: {
              test: /[\\/]node_modules[\\/]/,
              priority: -10,
              reuseExistingChunk: true,
            },
            // Separate heavy libraries into their own chunks
            reactForceGraph: {
              name: 'react-force-graph',
              test: /[\\/]node_modules[\\/](react-force-graph-2d|react-force-graph-3d)[\\/]/,
              priority: 20,
            },
            tiptap: {
              name: 'tiptap',
              test: /[\\/]node_modules[\\/]@tiptap[\\/]/,
              priority: 20,
            },
            d3: {
              name: 'd3',
              test: /[\\/]node_modules[\\/]d3[\\/]/,
              priority: 20,
            },
            markdown: {
              name: 'markdown',
              test: /[\\/]node_modules[\\/](markdown-it|turndown)[\\/]/,
              priority: 20,
            },
          },
        },
      };
    }

    return config;
  },
  // Redirects
  async redirects() {
    return [
      {
        source: '/',
        destination: '/home',
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;

