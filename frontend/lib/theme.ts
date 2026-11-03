/** The key the chosen theme is kept under in the browser. */
export const THEME_KEY = "vs-theme";

export type Theme = "light" | "dark";

/**
 * Runs in the page head, before the first paint, so a saved night theme is on
 * from the first frame and the page never flashes light. Storage can be
 * unavailable (private windows, blocked site data), so the page works without it.
 */
export const THEME_INIT_SCRIPT = `(function(){try{if(localStorage.getItem(${JSON.stringify(THEME_KEY)})==="dark"){document.documentElement.setAttribute("data-theme","dark");}}catch(e){}})();`;
