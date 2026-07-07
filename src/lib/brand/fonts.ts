import { Cormorant_Garamond, Manrope } from "next/font/google";

/** Заголовки: премиальный serif для beauty-бренда. */
export const fontDisplay = Cormorant_Garamond({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

/** Основной текст и интерфейс. */
export const fontBody = Manrope({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});
