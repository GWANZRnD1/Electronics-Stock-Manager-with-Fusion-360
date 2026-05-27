import { useEffect, useRef } from "react";

/**
 * Ref for a scroll container where holding Alt + mouse wheel scrolls it
 * horizontally — used by the spreadsheet-style tables. Desktop-only by nature
 * (needs a wheel). A native non-passive listener is required because React's
 * onWheel is passive, so preventDefault there would be a no-op.
 */
export function useAltWheelScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey || e.deltaY === 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  return ref;
}
