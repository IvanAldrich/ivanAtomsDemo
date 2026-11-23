import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

type FooterGroup = {
  title: string;
  links: Array<{ label: string; href: string; external?: boolean }>;
};

export async function SiteFooter() {
  const t = await getTranslations("footer");
  const n = await getTranslations("nav");

  const groups: FooterGroup[] = [
    {
      title: t("product"),
      links: [
        { label: n("pricing"), href: "/pricing" },
        { label: n("aiAgents"), href: "/ai-agents" },
        { label: n("models"), href: "/models" },
        { label: n("tools"), href: "/tools" },
      ],
    },
    {
      title: t("resources"),
      links: [
        { label: n("templates"), href: "/templates" },
        { label: n("discover"), href: "/discover" },
        { label: n("usecases"), href: "/usecases" },
        { label: n("comparison"), href: "/comparison" },
        { label: n("prompts"), href: "/prompts" },
      ],
    },
    {
      title: t("company"),
      links: [
        { label: n("about"), href: "/about" },
        { label: n("join"), href: "/join" },
      ],
    },
    {
      title: t("community"),
      links: [
        {
          label: t("github"),
          href: "https://github.com/IvanAldrich/ivanAtomsDemo",
          external: true,
        },
        { label: t("discord"), href: "https://discord.com", external: true },
        { label: t("twitter"), href: "https://x.com", external: true },
      ],
    },
  ];

  return (
    <footer className="border-t border-neutral-100 bg-neutral-50">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-4 py-12 md:grid-cols-4">
        {groups.map((group) => (
          <div key={group.title}>
            <h3 className="mb-3 text-sm font-semibold text-neutral-900">
              {group.title}
            </h3>
            <ul className="space-y-2 text-sm text-neutral-600">
              {group.links.map((link) =>
                link.external ? (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="hover:text-neutral-900"
                    >
                      {link.label}
                    </a>
                  </li>
                ) : (
                  <li key={link.href}>
                    <Link href={link.href} className="hover:text-neutral-900">
                      {link.label}
                    </Link>
                  </li>
                )
              )}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-neutral-100 py-4 text-center text-xs text-neutral-500">
        {t("rights", { year: new Date().getFullYear(), brand: "IvanAtoms" })}
      </div>
    </footer>
  );
}
