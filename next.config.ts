import type { NextConfig } from "next";

import { isIndexable } from "./src/lib/site";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["@base-ui/react"],
  },
  async rewrites() {
    return [
      // Browsers and crawlers still request /favicon.ico directly. Serve the
      // generated icon there so there is one favicon, drawn from the brand mark.
      { source: "/favicon.ico", destination: "/icon" },
    ];
  },
  async headers() {
    // Meta robots only covers HTML. The header also keeps images, llms.txt and
    // any other non-HTML response of a preview deployment out of the index.
    if (isIndexable) return [];

    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
