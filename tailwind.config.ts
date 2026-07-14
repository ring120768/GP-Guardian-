import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // GP status colors — used across dashboard, GP screen, alerts
        ok: "#16a34a",
        warn: "#d97706",
        risk: "#dc2626",
      },
    },
  },
  plugins: [],
};

export default config;
