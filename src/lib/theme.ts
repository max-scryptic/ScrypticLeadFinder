/*
 * Light or dark theme, chosen by the toggle in the top bar. The choice lives
 * in localStorage; with nothing stored the page follows the system setting.
 * Dark mode is the `.dark` class on <html>, which globals.css keys off.
 */

export type Theme = "light" | "dark"

export const THEME_STORAGE_KEY = "theme"

const DARK_QUERY = "(prefers-color-scheme: dark)"

export function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    return value === "light" || value === "dark" ? value : null
  } catch {
    return null
  }
}

export function systemTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light"
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Private windows can refuse storage; the theme still applies this visit.
  }
}

export function watchSystemTheme(onChange: (theme: Theme) => void) {
  const query = window.matchMedia(DARK_QUERY)
  const listener = () => onChange(query.matches ? "dark" : "light")
  query.addEventListener("change", listener)
  return () => query.removeEventListener("change", listener)
}

/*
 * Runs in <head> while the HTML is parsed, so the right theme is in place
 * before the first paint instead of flashing light on a dark-mode visit.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t!=="light"&&t!=="dark")t=matchMedia(${JSON.stringify(DARK_QUERY)}).matches?"dark":"light";document.documentElement.classList.toggle("dark",t==="dark")}catch(e){}})()`
