// Colour themes. The colours themselves live in index.html as CSS variables under [data-theme="…"].
export const THEMES = [
  { id: "prague", name: "Praha", tagline: "Terracotta roofs at golden hour", themeColor: "#8fbcd4" },
  { id: "night", name: "Prague by night", tagline: "Gas lamps and a full moon", themeColor: "#0b1030" },
  { id: "vltava", name: "Vltava", tagline: "Cool river blues", themeColor: "#bfe3ee" },
  { id: "petrin", name: "Petřín in spring", tagline: "Blossoms on the hill", themeColor: "#cfeedd" },
  { id: "classic", name: "Classic", tagline: "Plain and simple, follows dark mode", themeColor: "#1f4e79" },
];

export const DEFAULT_THEME = "prague";

export function applyTheme(id) {
  const theme = THEMES.find((t) => t.id === id) || THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.themeColor);
}
