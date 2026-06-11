/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "whoisgoing.s3.us-east-2.amazonaws.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "dice-media.imgix.net",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "s1.ticketm.net",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "www.clubcafe.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
