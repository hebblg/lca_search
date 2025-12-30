// app/robots.ts
import type { MetadataRoute } from "next";

export const runtime = "nodejs";
export const revalidate = 86400;

function getBaseUrl() {
  const canonical = process.env.NEXT_PUBLIC_SITE_URL;
  if (canonical) return canonical.replace(/\/+$/, "");

  // Hard fail so you don't accidentally publish vercel.app URLs in production
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Missing NEXT_PUBLIC_SITE_URL in production. Set it to https://yourdomain.com"
    );
  }

  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`.replace(/\/+$/, "");

  return "http://localhost:3000";
}


export default function robots(): MetadataRoute.Robots {
  const baseUrl = getBaseUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Optional: disallow internal endpoints if you have them
        // disallow: ["/api/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
