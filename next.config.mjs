/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A photo reaches sendMessageAction as base64, a third larger than the
  // file. The composer resizes first, so a normal send is a few hundred KB;
  // this is the ceiling for the odd huge PNG or a format the browser could
  // not re-encode. Next's default is 1MB, and exceeding it fails BEFORE the
  // action runs, as an anonymous "Something went wrong" with nothing logged.
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
  images: {
    // Shippo label PDFs / Supabase Storage assets are served from these hosts.
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "shippo-delivery-east.s3.amazonaws.com" },
      { protocol: "https", hostname: "deliver.goshippo.com" },
    ],
  },
};

export default nextConfig;
