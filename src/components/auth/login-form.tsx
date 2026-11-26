"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/navigation";

type Mode = "login" | "register";

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const t = useTranslations("auth");
  const brand = useTranslations()("brand");
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(t("invalidEmail"));
      return;
    }
    if (password.length < 8) {
      setError(t("invalidPassword"));
      return;
    }
    setPending(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          redirect: redirectTo,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (data.error === "email_taken") setError(t("emailTaken"));
        else if (data.error === "invalid_credentials")
          setError(t("invalidCredentials"));
        else setError(t("loginFailed"));
        return;
      }
      const data = (await res.json()) as { redirect: string };
      window.location.href = data.redirect;
    } catch {
      setError(t("loginFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-neutral-900">
        {mode === "login" ? t("loginTitle") : t("registerTitle")}
      </h1>
      <p className="mt-1 text-sm text-neutral-500">
        {t("loginSubtitle", { brand })}
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label
            htmlFor="email"
            className="mb-1 block text-sm font-medium text-neutral-700"
          >
            {t("emailLabel")}
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("emailPlaceholder")}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>
        <div>
          <label
            htmlFor="password"
            className="mb-1 block text-sm font-medium text-neutral-700"
          >
            {t("passwordLabel")}
          </label>
          <input
            id="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("passwordPlaceholder")}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
        >
          {pending
            ? mode === "login"
              ? t("submitting")
              : t("submittingRegister")
            : mode === "login"
              ? t("submit")
              : t("submitRegister")}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-neutral-500">
        {mode === "login" ? t("noAccount") : t("haveAccount")}{" "}
        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
          className="font-medium text-brand-600 hover:underline"
        >
          {mode === "login" ? t("switchToRegister") : t("switchToLogin")}
        </button>
      </p>
      <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
        {t("demoNotice")}
      </p>
      <p className="mt-4 text-center text-xs text-neutral-500">
        {t("agreePrefix")}{" "}
        <Link
          href="/terms-of-service"
          className="text-brand-600 hover:underline"
        >
          {t("terms")}
        </Link>{" "}
        {t("and")}{" "}
        <Link
          href="/privacy-policy"
          className="text-brand-600 hover:underline"
        >
          {t("privacy")}
        </Link>
      </p>
    </div>
  );
}