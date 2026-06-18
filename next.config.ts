import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Acknowledge Turbopack as the build system (Next.js 16 default)
  turbopack: {},
  // Keep webpack config for --webpack mode / older compatibility
  webpack: (config, { isServer }) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }

    return config;
  },
};

export default nextConfig;
