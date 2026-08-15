const storageImagePattern = (() => {
  const storageUrl =
    process.env.R2_PUBLIC_BASE_URL ||
    process.env.R2_PUBLIC_URL ||
    process.env.R2_ENDPOINT;
  if (!storageUrl) return null;

  try {
    const parsed = new URL(storageUrl);
    return {
      protocol: parsed.protocol.replace(":", ""),
      hostname: parsed.hostname,
      port: parsed.port,
      pathname: "/**",
    };
  } catch {
    return null;
  }
})();

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
      ...(storageImagePattern ? [storageImagePattern] : []),
      // Keep any legacy fully-qualified S3 image values renderable.
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
