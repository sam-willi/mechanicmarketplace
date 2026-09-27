import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Default .next. `npm run test:browser` builds into its own folder so it never touches a running dev server. */
  distDir: process.env.CLUTCH_DIST_DIR || ".next",
  /** No floating dev badge over the product, even in development demos. Errors still show. */
  devIndicators: false,
  /** Old single-dashboard routes, kept working for links already shared. */
  async redirects() {
    return [
      { source: "/account", destination: "/customer", permanent: false },
      { source: "/account/requests/:id", destination: "/customer/requests/:id", permanent: false },
      { source: "/account/quotes/:id", destination: "/customer/quotes/:id", permanent: false },
      { source: "/account/jobs/:id", destination: "/customer/jobs/:id", permanent: false },
      { source: "/request", destination: "/customer/requests/new", permanent: false },
      { source: "/mechanic/pricing", destination: "/mechanic/settings", permanent: false },
      { source: "/customer/home", destination: "/customer", permanent: false },
      { source: "/mechanic/home", destination: "/mechanic", permanent: false },
    ];
  },
};

export default nextConfig;
