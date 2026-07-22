"use client";

// Модалка «Все разговоры»: полный список с прокруткой.
// Данные грузятся при открытии — на главной достаточно последних трёх.

import { useEffect, useState } from "react";
import type { HomeConversation } from "@/lib/home";
import ConversationRow from "@/app/components/ConversationRow";

interface AllConversationsModalProps {
  onClose: () => void;
  onToggleFavorite: (id: string, isFavorite: boolean) => void;
  /** Избранное меняется и в модалке, и на главной — состояние держит страница */
  overrides: Record<string, boolean>;
}

export default function AllConversationsModal({
  onClose,
  onToggleFavorite,
  overrides,
}: AllConversationsModalProps) {
  const [conversations, setConversations] = useState<HomeConversation[] | null>(
    null
  );
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sessions");
        if (!res.ok) throw new Error("request failed");
        const data = await res.json();
        if (!cancelled) setConversations(data.conversations);
      } catch {
        if (!cancelled) setError("Не удалось загрузить список разговоров");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Закрытие по Escape — привычное поведение для модалки
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Все разговоры"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-[760px] flex-col overflow-hidden rounded-card border border-line bg-surface-card shadow-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="text-base font-semibold text-ink">Все разговоры</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="rounded-input p-1 text-ink-icon transition-colors hover:bg-surface-bubble hover:text-ink"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto">
          {error && <p className="px-5 py-6 text-sm text-danger-text">{error}</p>}

          {!error && conversations === null && (
            <p className="px-5 py-6 text-sm text-ink-muted">Загрузка…</p>
          )}

          {conversations?.length === 0 && (
            <p className="px-5 py-6 text-sm text-ink-muted">
              Разговоров пока нет.
            </p>
          )}

          {conversations?.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={{
                ...conversation,
                isFavorite:
                  overrides[conversation.id] ?? conversation.isFavorite,
              }}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
