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

export const log = {
  info: (event: string, data?: Record<string, unknown>) => emit("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => emit("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => {
    emit("error", event, data);
    // Optional Sentry forwarding — only if configured AND the dep is installed.
    // Variable specifier so TS doesn't require @sentry/node to be present.
    if (process.env.SENTRY_DSN) {
      const mod = "@sentry/node";
      import(/* @vite-ignore */ mod)
        .then((Sentry: { captureMessage?: (m: string, l: string) => void }) => {
          Sentry.captureMessage?.(`${event} ${JSON.stringify(data ?? {})}`, "error");
        })
        .catch(() => { /* @sentry/node not installed — JSON log is enough */ });
    }
  },
};
