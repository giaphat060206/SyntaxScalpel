/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#1E2329",
        panel: "#161B20",
        accent: "#00F0FF",
        mint: "#3DF0A8",
        dimmed: "#8A93A0",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
