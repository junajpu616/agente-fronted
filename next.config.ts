import type { NextConfig } from "next";

const robotHost = process.env.NEXT_PUBLIC_IP_AGENTE?.trim();

const nextConfig: NextConfig = {
  images: {
    remotePatterns: robotHost
      ? [
          {
            protocol: 'http',
            hostname: robotHost,
            port: '81',
            pathname: '/**',
          },
        ]
      : [],
  },
};

export default nextConfig;
