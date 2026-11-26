/** 应用独立域名：APP_BASE_DOMAIN=apps.example.com → slug.apps.example.com */
export function appBaseDomain(): string | null {
  const raw = process.env.APP_BASE_DOMAIN?.trim().toLowerCase();
  if (!raw) return null;
  return raw.replace(/^\.+/, "").replace(/\/.*$/, "");
}

export function slugFromHost(host: string | null): string | null {
  const base = appBaseDomain();
  if (!base || !host) return null;
  const hostname = host.split(":")[0].toLowerCase().replace(/\.$/, "");
  const suffix = `.${base}`;
  if (!hostname.endsWith(suffix)) return null;
  const slug = hostname.slice(0, -suffix.length);
  if (!slug || !/^[a-z0-9_-]+$/.test(slug)) return null;
  return slug;
}

export function isAppHost(host: string | null): boolean {
  return slugFromHost(host) !== null;
}