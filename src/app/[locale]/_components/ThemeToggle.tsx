"use client";

import { useEffect, useState } from "react";

// Light/dark switch. The initial theme is applied pre-paint by the inline
// script in the root layout; this control keeps React in sync and persists the
// user's choice to localStorage under `mz-theme`.
export default function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    setLight(document.documentElement.classList.contains("light"));
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle("light", next);
    try {
      localStorage.setItem("mz-theme", next ? "light" : "dark");
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
  }

  return (
    <button
      onClick={toggle}
      title={light ? "Tünd rejim" : "İşıqlı rejim"}
      aria-label={light ? "Tünd rejimə keç" : "İşıqlı rejimə keç"}
      className="flex items-center justify-center w-9 h-9 rounded-lg bg-card-2 border border-line-strong text-ink-2 hover:text-ink"
    >
      {light ? (
        // moon — click to go dark
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        // sun — click to go light
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      )}
    </button>
  );
}
