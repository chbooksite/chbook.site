// tailwind.config.js
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        sage:        { dark: "#2D5A50", DEFAULT: "#4A7C6F", water: "#6B9E91" },
        clay:        { DEFAULT: "#8B6F47", light: "#B8956A" },
        cream:       "#F8F5EF",
        charcoal:    "#1E2A24",
        graysage:    "#4A5E58",
        gold:        "#C9A84C",
      },
      fontFamily: {
        serif: ["'DM Serif Display'", "serif"],
        sans:  ["'DM Sans'", "sans-serif"],
        mono:  ["'DM Mono'", "monospace"],
      },
    },
  },
  plugins: [],
};