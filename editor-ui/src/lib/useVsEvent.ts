import { useEffect, type RefObject } from "react";

/** Attach a DOM event listener to a (web component) element ref. */
export function useVsEvent<T extends Event = Event>(ref: RefObject<HTMLElement | null>, name: string, handler: (e: T) => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = (e: Event) => handler(e as T);
    el.addEventListener(name, h);
    return () => el.removeEventListener(name, h);
  });
}
