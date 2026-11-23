import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/p/",
          "/preview/",
          "/zh/dashboard",
          "/zh/chat",
          "/en/dashboard",
          "/en/chat",
          "/zh/login",
          "/en/login",
        ],
      },
    ],
  };
}
