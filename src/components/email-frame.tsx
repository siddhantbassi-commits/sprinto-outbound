"use client";
import { useRef, useState } from "react";

/**
 * The formal email exactly as an inbox would draw it, in a frame that can run nothing: no scripts, and the HTML is built by
 * our own renderer from escaped text. The frame is allowed to be read by this page only so it can grow to fit its content.
 */
export function EmailFrame({ html, title = "The email as it will look" }: { html: string; title?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(520);
  const fit = () => {
    const doc = ref.current?.contentDocument;
    if (doc) setHeight(Math.min(1400, Math.max(320, doc.documentElement.scrollHeight)));
  };
  return <iframe ref={ref} className="mail-frame" title={title} sandbox="allow-same-origin" srcDoc={html} onLoad={fit} style={{ height }} />;
}
