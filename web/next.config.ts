import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the Node-stream Gerber renderer out of the server bundle (load at runtime).
  serverExternalPackages: ["pcb-stackup"],
};

export default nextConfig;
