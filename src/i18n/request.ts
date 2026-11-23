import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  let requested = await requestLocale;
  if (!requested || !routing.locales.includes(requested as "zh" | "en")) {
    requested = routing.defaultLocale;
  }

  return {
    locale: requested,
    messages: (await import(`../../messages/${requested}.json`)).default,
  };
});
