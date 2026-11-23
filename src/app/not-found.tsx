import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white text-center">
      <p className="text-5xl font-bold text-neutral-300">404</p>
      <p className="text-neutral-600">页面不存在 · Page not found</p>
      <Link
        href="/zh"
        className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        返回首页 / Home
      </Link>
    </div>
  );
}
