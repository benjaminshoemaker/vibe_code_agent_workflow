import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f2f2ff",
          100: "#dbdbff",
          200: "#b5b4ff",
          300: "#8b85ff",
          400: "#6b5cff",
          500: "#4a2fff",
          600: "#3a23d4",
          700: "#301ca9",
          800: "#26157f",
          900: "#170b4d"
        }
      }
    }
  },
  plugins: []
};

export default config;
