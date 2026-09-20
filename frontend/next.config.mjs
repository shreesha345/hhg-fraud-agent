/** @type {import('next').NextConfig} */
const nextConfig = {
  // @fraud/shared ships TypeScript source (zod schemas and the API contract)
  transpilePackages: ["@fraud/shared"],
  reactStrictMode: true,
};
export default nextConfig;
