/** @type {import('next').NextConfig} */
const nextConfig = {
  // GEX for a big chain can take 30s+ when Yahoo is slow; Next's proxy default is 30s.
  experimental: { proxyTimeout: 120_000 },
  allowedDevOrigins: ["optflw.com", "*.optflw.com", "*.ngrok.io", "*.ngrok-free.app", "localhost:3000", "localhost:3001"],
  async rewrites() {
    const backend = process.env.BACKEND_URL || "http://localhost:8000";
    return [
      // Versioned API: forwarded unchanged (backend serves /api/v1/*)
      { source: "/api/v1/:path*", destination: `${backend}/api/v1/:path*` },
      // Legacy paths: /api prefix stripped (backend serves /*)
      {
        source: "/api/:path*",
        destination: `${process.env.BACKEND_URL || "http://localhost:8000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
