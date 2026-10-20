"use client"

import { useEffect, useLayoutEffect } from "react"

import { Button } from "@/components/ui/button"
import {
  applyTheme,
  saveTheme,
  storedTheme,
  systemTheme,
  watchSystemTheme,
} from "@/lib/theme"

/*
 * Flips between light and dark. The icon is picked by CSS from the `.dark`
 * class rather than React state, so the server render and the first client
 * render match whatever theme the inline script in the root layout applied.
 */

export function ThemeToggle() {
  // React's dev Strict Mode remount resets <html> to its JSX className and
  // drops `.dark`; put it back before paint. A no-op in production.
  useLayoutEffect(() => {
    applyTheme(storedTheme() ?? systemTheme())
  }, [])

  // Until the user picks a theme, follow the system setting as it changes.
  useEffect(
    () =>
      watchSystemTheme((theme) => {
        if (!storedTheme()) applyTheme(theme)
      }),
    [],
  )

  function toggle() {
    const next = document.documentElement.classList.contains("dark") ? "light" : "dark"
    applyTheme(next)
    saveTheme(next)
  }

  return (
    <Button
      variant="ghost"
      size="icon-lg"
      className="rounded-full"
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      onClick={toggle}
    >
      {/* Moon in light mode, sun in dark mode: the icon shows where a click goes. */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="size-5 dark:hidden"
      >
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="hidden size-5 dark:block"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </svg>
    </Button>
  )
}
