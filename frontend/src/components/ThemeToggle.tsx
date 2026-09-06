"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { getTheme, setTheme, type Theme } from "@/lib/theme";
import { IconButton } from "./ui";

// The theme lives on document.documentElement's class list — an external
// mutable source, not React state — so useSyncExternalStore is the correct
// tool: it renders the server snapshot ("light") through hydration to
// avoid a mismatch, then reads the real DOM class right after. A plain
// "themechange" event is how our own toggle() notifies this subscription.
function subscribe(callback: () => void): () => void {
  window.addEventListener("themechange", callback);
  return () => window.removeEventListener("themechange", callback);
}

function getServerSnapshot(): Theme {
  return "light";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerSnapshot);

  function toggle() {
    setTheme(theme === "dark" ? "light" : "dark");
    window.dispatchEvent(new Event("themechange"));
  }

  return (
    <IconButton onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
      <span key={theme} className="animate-fade-in">
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </span>
    </IconButton>
  );
}
