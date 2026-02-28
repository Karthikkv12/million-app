/** @type {import('next').NextConfig} */
const nextConfig = {
  // Separate production build output from dev cache (.next) so `npm run build`
  // never overwrites the files the dev server is currently serving.
  distDir: process.env.NODE_ENV === "production" ? ".next-build" : ".next",
  allowedDevOrigins: ["optflw.com", "*.optflw.com", "*.ngrok.io", "*.ngrok-free.app", "localhost:3000", "localhost:3001", "localhost:3002"],
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
