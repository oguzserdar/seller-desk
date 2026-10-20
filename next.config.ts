import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // The dev badge sits over the phone ask box in screenshots and demos.
  devIndicators: false,
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default config;
