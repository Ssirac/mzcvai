import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Next 16 removed `next lint`; eslint-config-next@16 ships native flat configs,
// imported directly (no FlatCompat). Same presets the old .eslintrc.json used.
const eslintConfig = [
  ...coreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // New strict rule in react-hooks v6. The app's standard data-loading
      // pattern is "fetch on mount → setState in the effect callback", which
      // this rule flags wholesale; it's a performance style preference, not a
      // bug. Disabled to avoid churning 12 working screens.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // error.tsx / not-found.tsx deliberately use plain <a> — inside an error
    // boundary the client router state may itself be broken, so a hard
    // navigation home is the robust escape hatch.
    // NB: bracket-free globs — "[locale]" would otherwise parse as a glob
    // character class and never match the literal directory name.
    files: ["**/error.tsx", "**/not-found.tsx"],
    rules: { "@next/next/no-html-link-for-pages": "off" },
  },
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "extension/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
