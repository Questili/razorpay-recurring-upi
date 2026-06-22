/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship untranspiled TS source in some setups; transpile them
  // so Next can bundle the kit + adapters directly from source.
  transpilePackages: [
    "@questili/razorpay-recurring-upi",
    "@questili/razorpay-recurring-upi-provider",
    "@questili/razorpay-recurring-upi-prisma"
  ]
};

export default nextConfig;
