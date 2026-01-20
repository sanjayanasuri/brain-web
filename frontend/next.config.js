/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            default: false,
            vendors: false,
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
};

module.exports = nextConfig;

