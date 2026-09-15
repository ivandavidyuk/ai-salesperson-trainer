"use client";

// Липкая кнопка на телефоне: появляется после первого экрана и прячется,
// когда форма заявки на экране — две кнопки рядом ни к чему.

import { useEffect, useState } from "react";
import { CTA, FORM_ID, scrollToSection } from "./ui";

export default function StickyCta() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let formVisible = false;
    const update = () => setShow(window.scrollY > window.innerHeight * 0.7 && !formVisible);

    const form = document.getElementById(FORM_ID);
    const observer = form
      ? new IntersectionObserver(
          (entries) => {
            formVisible = entries.some((entry) => entry.isIntersecting);
            update();
          },
          { rootMargin: "0px 0px -80px 0px" },
        )
      : null;
    if (form && observer) observer.observe(form);

    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, []);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-[60] border-t border-line bg-surface/95 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 transition-[opacity,transform] duration-[250ms] lg:hidden ${
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0"
      }`}
    >
      <button type="button" onClick={() => scrollToSection(FORM_ID)} className={`w-full ${CTA}`}>
        Получить демо-доступ
      </button>
    </div>
  );
}
