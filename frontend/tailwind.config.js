/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F4F4F5",
        ink: "#0A0A0A",
        mute: "#71717A",
        line: "#E4E4E7",
        brand: "#FF5A00",
        "brand-soft": "#FFF0E8",
        "brand-dark": "#D94800",
        "brand-muted": "#FF8A4C",
        good: "#15803D",
        bad: "#DC2626",
        warn: "#D97706",
        idle: "#A1A1AA",
        surface: "#FFFFFF",
        night: "#0A0A0A",
      },
      fontFamily: {
        sans: ["\"DM Sans\"", "Segoe UI", "system-ui", "sans-serif"],
        display: ["\"Space Grotesk\"", "\"DM Sans\"", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(10,10,10,0.04)",
        lift: "0 12px 32px rgba(10,10,10,0.08)",
      },
    },
  },
  plugins: [],
};
