import type { ReactNode } from "react";

/**
 * A small hand-set icon family: 24px grid, 1.75px round strokes, drawn from paths (no icon font, no network). Each name is a
 * real concept in the product, and every icon sits beside a text label or carries an aria-label, never alone.
 */
const PATHS = {
  runs: "M12 3 3 7.5l9 4.5 9-4.5L12 3Z M3 12l9 4.5 9-4.5 M3 16.5 12 21l9-4.5",
  plus: "M12 5v14 M5 12h14",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.7 21a2 2 0 0 1-3.4 0",
  chart: "M5 21V11 M12 21V4 M19 21v-8",
  pulse: "M3 12h4l3 8 4-16 3 8h4",
  chat: "M21 12a8 8 0 0 1-11.8 7L4 20l1.2-4.6A8 8 0 1 1 21 12Z",
  target: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z",
  book: "M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4V4Z M8 9h6 M8 13h6",
  sliders: "M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 4v6 M9 14v6",
  people: "M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1 M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M21 20v-1a3 3 0 0 0-2.2-2.9 M16 4.3a3.5 3.5 0 0 1 0 6.4",
  mail: "M4 6h16v12H4V6Z M4 7.5 12 13l8-5.5",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z M20 20l-4-4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M12 2.5v2 M12 19.5v2 M2.5 12h2 M19.5 12h2 M5.3 5.3l1.4 1.4 M17.3 17.3l1.4 1.4 M5.3 18.7l1.4-1.4 M17.3 6.7l1.4-1.4",
  check: "M5 12.5 10 17.5 19 7",
  x: "M6 6l12 12 M18 6 6 18",
  alert: "M12 8v5 M12 16.5v.01 M10.3 4 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z",
  info: "M12 11v5 M12 7.5v.01 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  external: "M14 4h6v6 M20 4 11 13 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  copy: "M9 9h10v11H9V9Z M5 15V4h10",
  play: "M7 4.5v15l12-7.5L7 4.5Z",
  pause: "M8 5v14 M16 5v14",
  shield: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z M9 12l2 2 4-4",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z M19 16l.7 2.1L22 19l-2.3.9L19 22l-.7-2.1L16 19l2.3-.9L19 16Z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
  edit: "M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z M14 6l4 4",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 7v5l3 2",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4 21a8 8 0 0 1 16 0",
  inbox: "M4 13l2-8h12l2 8 M4 13v6h16v-6 M4 13h4l1 2h6l1-2h4",
  list: "M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01",
  flag: "M5 21V4 M5 4h12l-2 4 2 4H5",
  keyboard: "M3 7h18v10H3V7Z M7 11h.01 M11 11h.01 M15 11h.01 M7 14.5h10",
  help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7 M12 17v.01",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M3 12h18 M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z",
  lock: "M6 11h12v9H6v-9Z M8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  refresh: "M20 11a8 8 0 0 0-14.5-3.5 M4 5v4h4 M4 13a8 8 0 0 0 14.5 3.5 M20 19v-4h-4",
  upload: "M12 16V4 M7 9l5-5 5 5 M4 16v4h16v-4",
  down: "M6 9l6 6 6-6",
  coins: "M12 4c-4.4 0-8 1.3-8 3s3.6 3 8 3 8-1.3 8-3-3.6-3-8-3Z M4 7v5c0 1.7 3.6 3 8 3s8-1.3 8-3V7 M4 12v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, label, size }: { name: IconName; label?: string; size?: number }): ReactNode {
  return (
    <svg className="icon" viewBox="0 0 24 24" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={size ? { width: size, height: size } : undefined}>
      <path d={PATHS[name]} />
    </svg>
  );
}
