"use client";

// Общие хуки лендинга: появление при прокрутке и плавные числа.

import { useEffect, useRef, useState } from "react";

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * Попал ли элемент в экран — один раз и навсегда.
 *
 * Нижние 12% экрана не считаются: блок, едва показавший край, ещё не виден,
 * и анимация, отыгравшая под обрезом, пропала бы зря.
 */
export function useInView<T extends Element>(rootMargin = "0px 0px -12% 0px") {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  return [ref, inView] as const;
}

/**
 * Показан ли элемент для анимации появления.
 *
 * До гидрации и для всего, что видно сразу, — показан: без скрипта ничего
 * не пропадает, и первый экран не мигает. Ниже экрана элемент прячется
 * и показывается, когда до него долистали.
 */
export function useReveal<T extends Element>() {
  const [ref, inView] = useInView<T>();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || prefersReducedMotion()) return;
    if (element.getBoundingClientRect().top > window.innerHeight * 0.88) setArmed(true);
  }, [ref]);

  return [ref, !armed || inView] as const;
}

/**
 * Плавно ведёт число к цели. Первое значение показывается сразу; `instant`
 * переставляет без анимации — например, спрятать число в ноль до появления.
 */
export function useAnimatedNumber(target: number, duration = 700, instant = false): number {
  const [value, setValue] = useState(target);
  const currentRef = useRef(target);

  useEffect(() => {
    const from = currentRef.current;
    if (from === target) return;
    if (instant || prefersReducedMotion()) {
      currentRef.current = target;
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = progress < 1 ? from + (target - from) * eased : target;
      currentRef.current = next;
      setValue(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, instant]);

  return value;
}

/**
 * Число, которое докручивается с нуля, когда секция появилась.
 *
 * До гидрации показывается итог — без скрипта число не должно быть нулём.
 * После гидрации число ниже экрана прячется в ноль мгновенно, а при
 * появлении едет к цели.
 */
export function useCountOnReveal(target: number, inView: boolean, duration = 900): number {
  const [armed, setArmed] = useState(false);
  const inViewRef = useRef(inView);
  inViewRef.current = inView;

  useEffect(() => {
    if (!inViewRef.current && !prefersReducedMotion()) setArmed(true);
  }, []);

  const waiting = armed && !inView;
  return useAnimatedNumber(waiting ? 0 : target, duration, waiting);
}
