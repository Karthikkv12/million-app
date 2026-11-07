/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["optflw.com", "*.optflw.com", "*.ngrok.io", "*.ngrok-free.app", "localhost:3000", "localhost:3001"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.BACKEND_URL || "http://localhost:8000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
