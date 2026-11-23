import { Logo } from "@/components/layout/logo";
import { Link } from "@/i18n/navigation";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <Logo />
        <span className="text-lg font-semibold text-neutral-900">IvanAtoms</span>
      </Link>
      {children}
    </div>
  );
}
