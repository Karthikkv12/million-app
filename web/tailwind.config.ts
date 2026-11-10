import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "rgb(var(--background-rgb) / <alpha-value>)",
        foreground: "rgb(var(--foreground-rgb) / <alpha-value>)",
        accent: "rgb(var(--accent-rgb) / <alpha-value>)",
        warm: "rgb(var(--warm-rgb) / <alpha-value>)",
        gain: "rgb(var(--gain-rgb) / <alpha-value>)",
        loss: "rgb(var(--loss-rgb) / <alpha-value>)",
        warn: "rgb(var(--warn-rgb) / <alpha-value>)",
        "on-tone": "var(--on-tone)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      screens: {
        // Keep Tailwind defaults but add named aliases for clarity:
        // xs: 480px (large phone landscape)
        xs: "480px",
        // sm: 640px (default) — small tablet / large phone landscape
        // md: 768px (default) — iPad portrait ← sidebar kicks in here
        // lg: 1024px (default) — iPad landscape / small laptop
        // xl: 1280px (default) — laptop
        // 2xl: 1536px (default) — desktop
      },
    },
  },
  plugins: [],
};
export default config;
