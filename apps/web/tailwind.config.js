// tailwind.config.js
// Paleta oficial de ChBook (03_ChBook_Brand_Guidelines, ver docs/DISENO.md).
// Paleta plana: sin degradados. Máximo 3 colores por pantalla: sage manda,
// marrón contrasta, crema da respiro. Los nombres heredados (sage, clay,
// vela…) se conservan para no tocar cada componente.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Sage — color principal. dark=headers/CTA · DEFAULT=acentos e iconos activos
        // · water=verde agua (métricas, highlights) · light=tinte de fondo.
        sage:     { deep: "#244A42", dark: "#2D5A50", DEFAULT: "#4A7C6F", water: "#6B9E91", light: "#E6EFEC" }, // deep = hover del CTA
        // Marrón cálido — CTAs secundarios y contraste (equipos, cumpleaños, prospectos).
        clay:     { DEFAULT: "#8B6F47", light: "#E8E0D2" }, // light = bordes cálidos
        vela:     { DEFAULT: "#8B6F47", light: "#F2EBDF", dark: "#6F5836" },
        bronze:   "#B8956A",   // marrón claro: bordes premium
        danger:   "#B3261E",   // SOLO errores y acciones destructivas
        // Neutros (crema da respiro).
        paper:    "#F8F5EF",   // crema: fondo de página
        beige:    { DEFAULT: "#F2EBDF", light: "#FBF9F5" },
        sand:     "#E8DCC6",
        cream:    "#F1ECE2",   // superficies secundarias, hover, sublistas
        charcoal: "#1E2A24",   // carbón verde: texto fuerte
        graysage: "#4A5E58",   // gris sage: texto secundario
        faint:    "#8A9893",   // placeholders, texto muy tenue
        // Logo.
        ink:      "#1C1C1E",   // fondo del app icon
        gold:     "#C9A84C",   // dorado mate de las letras del logo
      },
      fontFamily: {
        serif: ["DM Serif Display", "Georgia", "serif"], // títulos principales (peso 400)
        sans:  ["Plus Jakarta Sans", "system-ui", "sans-serif"],
        mono:  ["DM Mono", "ui-monospace", "Menlo", "monospace"], // códigos CHBK-XXXX
      },
    },
  },
  plugins: [],
};
