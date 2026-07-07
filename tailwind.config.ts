import type { Config } from "tailwindcss";

// Semantic tokens backed by CSS variables (defined in globals.css). Using the
// rgb(var(--x) / <alpha-value>) form keeps Tailwind's opacity modifiers working
// (e.g. bg-card/60, border-line/50). Themes flip by toggling `.light` on <html>.
const token = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: token("--surface"),
        "surface-2": token("--surface-2"),
        card: token("--card"),
        "card-2": token("--card-2"),
        line: token("--line"),
        "line-strong": token("--line-strong"),
        ink: token("--ink"),
        "ink-2": token("--ink-2"),
        "ink-3": token("--ink-3"),
        accent: token("--accent"),
        "accent-strong": token("--accent-strong"),
      },
      fontFamily: {
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
