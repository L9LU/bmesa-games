// Site-wide motion: Lenis smooth scrolling kept in sync with GSAP ScrollTrigger.
// Everything is skipped for visitors who ask their device for reduced motion.
import { useEffect } from 'react';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.config({ ignoreMobileResize: true });

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let lenis = null;

/** Start Lenis once for the whole app (call from the layout). */
export function useSmoothScroll() {
  useEffect(() => {
    // Content keeps changing height (data loads, images arrive); re-measure scroll triggers when it does
    let t = 0;
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => ScrollTrigger.refresh(), 150); });
    ro.observe(document.body);
    if (prefersReducedMotion()) return () => { ro.disconnect(); clearTimeout(t); };

    lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    const raf = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(raf);
      lenis.destroy();
      lenis = null;
      ro.disconnect();
      clearTimeout(t);
    };
  }, []);
}

/** Jump to the top on page change (Lenis-aware), then re-measure scroll triggers. */
export function scrollToTop() {
  if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
  else window.scrollTo(0, 0);
  requestAnimationFrame(() => ScrollTrigger.refresh());
}
