// Motion: one place for durations, curves and the few animations that need JS (see the animation plan).
// Rules: feedback starts at once (< 100 ms), nothing waits for an animation, everything is interruptible,
// reduced motion = no movement (only colour changes, handled in CSS).
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export const DUR = { press: 120, ui: 200, move: 320, party: 600 } as const;
export const EASE = { out: "cubic-bezier(.2,.8,.2,1)", spring: "cubic-bezier(.34,1.56,.64,1)" } as const;
export const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// FLIP for every element with data-flip="<key>": when `dep` changes (the video list), each element slides from where
// it was on screen to where it is now (another column, another day, another place in a list). New ones grow in.
// Positions are re-read on scroll/resize, so a scroll between two changes never turns into a fake movement.
export function useFlip(dep: unknown) {
  const last = useRef<Map<string, DOMRect>>(new Map());
  const first = useRef(true);
  useEffect(() => {
    let raf = 0;
    const snap = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { last.current = read(); }); };
    window.addEventListener("scroll", snap, true); window.addEventListener("resize", snap);
    snap();
    return () => { window.removeEventListener("scroll", snap, true); window.removeEventListener("resize", snap); cancelAnimationFrame(raf); };
  }, []);
  useLayoutEffect(() => {
    const now = read();
    if (first.current || reduced()) { first.current = false; last.current = now; return; }
    const before = last.current;
    for (const [key, r] of now) {
      const el = document.querySelector<HTMLElement>(`[data-flip="${CSS.escape(key)}"]`);
      if (!el) continue;
      const o = before.get(key);
      if (!o) { if (before.size) el.animate([{ opacity: 0, transform: "scale(.96)" }, { opacity: 1, transform: "none" }], { duration: DUR.ui, easing: EASE.out }); continue; }
      const dx = o.left - r.left, dy = o.top - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      const far = Math.hypot(dx, dy) > 120; // a long trip (to another column/day) lands with a small bounce
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: far ? DUR.move : DUR.ui, easing: far ? EASE.spring : EASE.out });
    }
    last.current = now;
  }, [dep]);
}
function read() {
  const m = new Map<string, DOMRect>();
  document.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => m.set(el.dataset.flip!, el.getBoundingClientRect()));
  return m;
}

// A number that bumps when it changes (column counters, "No date" count)
export function Count({ n, className }: { n: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null), prev = useRef(n);
  useEffect(() => {
    if (prev.current !== n && ref.current && !reduced()) ref.current.animate(
      [{ transform: "none" }, { transform: `translateY(${n > prev.current ? -3 : 3}px) scale(1.15)` }, { transform: "none" }], { duration: 240, easing: EASE.spring });
    prev.current = n;
  }, [n]);
  return <span ref={ref} className={className} style={{ display: "inline-block" }}>{n}</span>;
}

// Small burst of confetti from an element (only when a video reaches "Finalizado")
export function celebrate(el: Element | null) {
  if (!el || reduced()) return;
  const r = el.getBoundingClientRect(), cols = ["#2F8A5B", "#5A4BD1", "#B87A12", "#C23B5E", "#3767A8"];
  for (let i = 0; i < 16; i++) {
    const d = document.createElement("i");
    d.className = "confetti";
    Object.assign(d.style, { left: `${r.left + r.width / 2}px`, top: `${r.top + 16}px`, background: cols[i % cols.length] });
    document.body.appendChild(d);
    const a = (Math.PI * 2 * i) / 16, dist = 40 + Math.random() * 30;
    d.animate([{ transform: "translate(-50%,-50%)", opacity: 1 }, { transform: `translate(${Math.cos(a) * dist * 1.5}px, ${Math.sin(a) * dist - 10}px) rotate(${Math.random() * 360}deg)`, opacity: 0 }],
      { duration: DUR.party, easing: EASE.out }).onfinish = () => d.remove();
  }
}

// "Saved" tick shown for a moment after a block is saved
export function useFlash(trigger: unknown, ms = 1400) {
  const [on, setOn] = useState(false), first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setOn(true); const t = setTimeout(() => setOn(false), ms); return () => clearTimeout(t);
  }, [trigger]);
  return on;
}
