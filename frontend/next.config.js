/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow loading external modules for graph visualization
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
    };
    return config;
  },
};

module.exports = nextConfig;

