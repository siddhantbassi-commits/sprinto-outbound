import { setTheme } from "@/app/theme/actions";
import { Icon } from "./icons";

/** One button that moves light, then dark, then back to following the computer. Server-rendered: no script, no flash. */
export function ThemeToggle({ current }: { current: "light" | "dark" | "auto" }) {
  const next = current === "auto" ? "light" : current === "light" ? "dark" : "auto";
  const label = current === "auto" ? "Theme: follows your computer. Switch to light." : current === "light" ? "Theme: light. Switch to dark." : "Theme: dark. Switch to following your computer.";
  return (
    <form action={setTheme}>
      <input type="hidden" name="theme" value={next} />
      <button className="icon-btn light" type="submit" title={label} aria-label={label}>
        <Icon name={current === "dark" ? "moon" : "sun"} />
      </button>
    </form>
  );
}
