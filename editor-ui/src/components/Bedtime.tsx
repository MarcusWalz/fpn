import { useEffect, useRef, useState } from "react";

// The editor closes overnight (browser's local time). Reading the site is unaffected.
export const CLOSED_FROM = 23; // 11 pm
export const CLOSED_UNTIL = 5; // 5 am

export const isBedtime = (d = new Date()) => d.getHours() >= CLOSED_FROM || d.getHours() < CLOSED_UNTIL;

/** Re-checks the clock every 30 s. Calls onClose once when bedtime starts (to save unsaved work). */
export function useBedtime(onClose: () => void): boolean {
  const [closed, setClosed] = useState(isBedtime);
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    const tick = () => setClosed((was) => {
      const now = isBedtime();
      if (now && !was) cb.current();
      return now;
    });
    const t = setInterval(tick, 30_000);
    addEventListener("focus", tick);
    return () => { clearInterval(t); removeEventListener("focus", tick); };
  }, []);
  return closed;
}

export default function Bedtime() {
  return (
    <div className="bedtime" role="dialog" aria-modal="true" aria-labelledby="bedtime-title">
      <div className="bedtime-card">
        <div className="bedtime-moon" aria-hidden="true">☾</div>
        <h2 id="bedtime-title">Hudson demands you sleep</h2>
        <p>It's late. Your work is saved, and the notebook will be here in the morning.</p>
        <p className="bedtime-sub">The editor is closed from 11 pm to 5 am. You can still read the site.</p>
        <a href="/">Go to the site</a>
      </div>
    </div>
  );
}
