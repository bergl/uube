// Colour themes. The colours live in index.html as CSS variables under [data-theme="…"];
// names and taglines are translated in i18n.js ("theme.<id>.name").
export const THEMES = [{ id: "prague" }, { id: "night" }, { id: "vltava" }, { id: "petrin" }, { id: "classic" }];

export const DEFAULT_THEME = "prague";

// The browser chrome (and the iOS status bar of the home-screen app) takes the
// colour of the top of the header, so the sky runs seamlessly to the screen edge.
function syncThemeColor() {
  const sky = getComputedStyle(document.documentElement).getPropertyValue("--sky-1").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", sky);
}

export function applyTheme(id) {
  const theme = THEMES.find((t) => t.id === id) || THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  syncThemeColor();
}

// The Classic theme follows the phone's dark mode, which changes its sky colour.
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", syncThemeColor);
