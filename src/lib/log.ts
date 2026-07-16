/**
 * Minimal structured logger — emits one JSON line per event so Railway logs (or
 * any aggregator / Sentry log-drain) can parse level, event and context. Falls
 * back silently; logging must never throw. If SENTRY_DSN is set, error() also
 * forwards to Sentry when @sentry/node is available at runtime (optional dep).
 */

type Level = "info" | "warn" | "error";

function emit(level: Level, event: string, data?: Record<string, unknown>) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(data ?? {}) });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  } catch {
    /* never throw from logging */
  }
}

// Lazy Sentry init — on the first error() call when SENTRY_DSN is set, import
// @sentry/node (Node runtime only) and init once. Kept out of instrumentation.ts
// so @sentry/node is never bundled into the edge runtime (it needs node:*).
type SentryLike = {
  init?: (o: Record<string, unknown>) => void;
  captureMessage?: (m: string, l?: string) => void;
};
let sentryPromise: Promise<SentryLike | null> | null = null;
function getSentry(): Promise<SentryLike | null> {
  if (!process.env.SENTRY_DSN) return Promise.resolve(null);
  if (!sentryPromise) {
    const mod = "@sentry/node";
    sentryPromise = import(/* webpackIgnore: true */ /* @vite-ignore */ mod)
      .then((Sentry: SentryLike) => {
        Sentry.init?.({
          dsn: process.env.SENTRY_DSN,
          environment: process.env.NODE_ENV,
          tracesSampleRate: 0, // errors only
        });
        return Sentry;
      })
      .catch(() => null); // dep missing / init failed — JSON log is enough
  }
  return sentryPromise;
}

export const log = {
  info: (event: string, data?: Record<string, unknown>) => emit("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => emit("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => {
    emit("error", event, data);
    if (process.env.SENTRY_DSN) {
      void getSentry().then((Sentry) => {
        Sentry?.captureMessage?.(`${event} ${JSON.stringify(data ?? {})}`, "error");
      });
    }
  },
};
