import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native/CJS-heavy deps out of the server bundle so they load at runtime:
  // sharp (native image rasterizer) and pcb-stackup (Node-stream Gerber renderer).
  serverExternalPackages: ["sharp", "@resvg/resvg-js", "pcb-stackup"],
};

export default nextConfig;
