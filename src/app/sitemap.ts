import type { MetadataRoute } from "next";
import { publishedByCategory } from "@/content/entries";

const BASE = process.env.SITE_BASE_URL ?? "http://localhost:3000";

const STATIC_ROUTES = [
  "",
  "/pricing",
  "/ai-agents",
  "/models",
  "/tools",
  "/templates",
  "/discover",
  "/usecases",
  "/comparison",
  "/prompts",
  "/about",
  "/join",
  "/privacy-policy",
  "/terms-of-service",
];

const DETAIL_CATEGORIES = [
  "models",
  "usecases",
  "comparison",
  "prompts",
  "discover",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const urls: MetadataRoute.Sitemap = [];
  for (const locale of ["zh", "en"]) {
    for (const route of STATIC_ROUTES) {
      urls.push({
        url: `${BASE}/${locale}${route}`,
        changeFrequency: "weekly",
        priority: route === "" ? 1 : 0.7,
      });
    }
    for (const category of DETAIL_CATEGORIES) {
      for (const entry of publishedByCategory(category)) {
        urls.push({
          url: `${BASE}/${locale}/${category}/${entry.slug}`,
          changeFrequency: "monthly",
          priority: 0.5,
        });
      }
    }
  }
  return urls;
}
