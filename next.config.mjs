/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: "/venues/:path*",
        destination: "/venue/:path*",
        permanent: true,
      },
      {
        source: "/venues-and-organizers",
        destination: "/places",
        permanent: true,
      },
      {
        source: "/friends",
        destination: "/activity",
        permanent: true,
      },
      {
        source: "/friends/list",
        destination: "/activity?view=list",
        permanent: true,
      },
      {
        source: "/friends/requests",
        destination: "/activity?view=requests",
        permanent: true,
      },
      {
        source: "/friends/search",
        destination: "/activity/search",
        permanent: true,
      },
      {
        source: "/friends/activity",
        destination: "/activity",
        permanent: true,
      },
    ];
  },
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
