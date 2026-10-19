import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Produces the minimal server bundle used by the OCI production image.
  // This keeps node_modules and build tooling out of the runtime container.
  output: "standalone",
};

export default nextConfig;
