const config = {
  output: "standalone",
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_INTERNAL_URL || "http://localhost:3001"}/api/:path*`,
      },
    ];
  },
};
export default config;
