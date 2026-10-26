// tailwind.config.js
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Marca Chbook: verde salvia + beige + gris del logo.
        sage:     { dark: "#5C7A67", DEFAULT: "#9FBCA6", water: "#C8DACD", light: "#E7EEE8" },
        clay:     { DEFAULT: "#B98C63", light: "#E4D9C6" }, // acento cálido / bordes beige
        beige:    { DEFAULT: "#E9E0CE", light: "#F6F1E8" },
        cream:    "#F6F1E8",   // superficie beige muy clara (los fondos de página van en blanco)
        charcoal: "#34403A",   // texto principal (gris verdoso oscuro)
        graysage: "#5E6A64",   // texto secundario = gris del logo
        gold:     "#B98C63",
      },
      fontFamily: {
        serif: ["Poppins", "ui-sans-serif", "sans-serif"], // marca / títulos (redondeada)
        sans:  ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono:  ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};