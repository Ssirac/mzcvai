"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

const LOCALES = ["az", "de", "en"] as const;

export default function LoginPage() {
  const { locale } = useParams() as { locale: string };
  const router = useRouter();
  const t = useTranslations("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        router.replace(`/${locale}/dashboard`);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4 relative overflow-hidden">
      {/* ambient gradient */}
      <div className="pointer-events-none absolute -top-1/3 left-1/2 -translate-x-1/2 w-[60rem] h-[60rem] rounded-full bg-accent/5 blur-3xl" />

      <div className="absolute top-4 right-4 flex gap-1 text-xs">
        {LOCALES.map((l) => (
          <a key={l} href={`/${l}/login`}
            className={`px-2 py-1 rounded ${locale === l ? "bg-card-2 text-ink" : "text-ink-3 hover:text-ink"}`}>
            {l.toUpperCase()}
          </a>
        ))}
      </div>

      <div className="relative w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-emerald-500/20 ring-1 ring-white/10">
            MZ
          </div>
          <div>
            <div className="text-ink font-bold leading-tight">{t("title")}</div>
            <div className="text-ink-3 text-xs">{t("subtitle")}</div>
          </div>
        </div>

        <form onSubmit={submit} className="card p-6 space-y-4">
          <div>
            <label className="text-xs text-ink-3">{t("username")}</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              className="field mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-ink-3">{t("password")}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="field mt-1"
            />
          </div>

          {error && (
            <div className="text-sm bg-red-500/10 pill-red border border-red-500/30 rounded-lg px-3 py-2">
              {t("error")}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="btn btn-primary w-full"
          >
            {loading ? t("signingIn") : t("signIn")}
          </button>
        </form>
      </div>
    </div>
  );
}
