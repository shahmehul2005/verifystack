"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { THEME_KEY, type Theme } from "@/lib/theme";

const CHANGED = "vs-theme-change";

function subscribe(onChange: () => void) {
  function onStorage(e: StorageEvent) {
    // Another tab chose a theme: follow it here.
    if (e.key === THEME_KEY) {
      apply(e.newValue === "dark" ? "dark" : "light", false);
      onChange();
    }
  }
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

const read = (): Theme => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

/** Put a theme on the page and, when asked, remember it. */
function apply(theme: Theme, remember: boolean) {
  if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  if (!remember) return;
  try {
    if (theme === "dark") localStorage.setItem(THEME_KEY, "dark");
    else localStorage.removeItem(THEME_KEY);
  } catch {
    // Storage is blocked: the theme still applies until the page is closed.
  }
}

/** A day / night switch. The choice is remembered in this browser. */
export function ThemeToggle({ className }: { className?: string }) {
  // The server cannot know the choice, so it renders day and the browser corrects it after hydration.
  const theme = useSyncExternalStore(subscribe, read, () => "light" as Theme);
  const dark = theme === "dark";
  const label = dark ? "Switch to day theme" : "Switch to night theme";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        apply(dark ? "light" : "dark", true);
        window.dispatchEvent(new Event(CHANGED));
      }}
      className={cn("flex size-8 items-center justify-center rounded-md text-mist-600 transition-colors hover:bg-mist-900/5 hover:text-mist-900", className)}
    >
      {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
}
