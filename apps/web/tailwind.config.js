// tailwind.config.js
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Marca Chbook: verde vivo #559670 + grises suaves (#383835, #7E807B,
        // #D8D8D8) y blanco.
        // Verde: dark=oscuro #559670 (botones) · DEFAULT=vivo · light=claro.
        sage:     { dark: "#5CA27B", DEFAULT: "#88C0A4", water: "#C4DFD2", light: "#E2EFE9" },
        clay:     { DEFAULT: "#B5897A", light: "#D8D8D8" }, // acento/alertas + bordes gris claro
        beige:    { DEFAULT: "#EDE4D3", light: "#F4EEE2" }, // beige cálido (protagonista)
        sand:     "#E0CCBE", // arena/terracota claro — acento selectivo (p. ej. una métrica)
        cream:    "#EFEFEE",   // gris muy claro (fondo de inputs/superficies)
        charcoal: "#383835",   // gris oscuro (texto / oscuros)
        graysage: "#7E807B",   // gris medio (texto secundario)
        gold:     "#9DA99B",
        // Pasteles que ENRIQUECEN la base (verde + gris) sin salirse de la marca:
        mist:  { DEFAULT: "#C4D7D3", dark: "#6E9B93" }, // azul-verdoso polvoriento
        mauve: { DEFAULT: "#DAC8CF", dark: "#9E7E8B" }, // rosa polvoriento
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