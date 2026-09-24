"use client";

// Модалка «Все разговоры»: полный список с прокруткой.
// Данные грузятся при открытии — на главной достаточно последних трёх.
// На телефоне — экран целиком со стрелкой назад и разговорами карточками.

import { useEffect, useState } from "react";
import type { HomeConversation } from "@/lib/home";
import ConversationCard from "@/app/components/ConversationCard";
import ConversationRow from "@/app/components/ConversationRow";
import Loader from "@/app/components/Loader";

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 max-md:px-0"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Все разговоры"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-[760px] flex-col overflow-hidden rounded-card border border-line bg-surface-card shadow-card max-md:h-dvh max-md:max-h-none max-md:max-w-none max-md:rounded-none max-md:border-0 max-md:bg-surface max-md:shadow-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4 max-md:h-14 max-md:shrink-0 max-md:justify-start max-md:gap-1 max-md:bg-surface-card max-md:px-1.5 max-md:py-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="Назад"
            className="inline-flex h-11 w-11 items-center justify-center text-ink md:hidden"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <div className="text-base font-semibold text-ink max-md:text-[18px]">Все разговоры</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="rounded-input p-1 text-ink-icon transition-colors hover:bg-surface-bubble hover:text-ink max-md:hidden"
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
            <div className="px-5 py-10">
              <Loader />
            </div>
          )}

          {conversations?.length === 0 && (
            <p className="px-5 py-6 text-sm text-ink-muted">
              Разговоров пока нет.
            </p>
          )}

          <div className="max-md:hidden">
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

          {conversations && conversations.length > 0 && (
            <div className="flex flex-col gap-2.5 p-4 md:hidden">
              {conversations.map((conversation) => (
                <ConversationCard
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
          )}
        </div>
      </div>
    </div>
  );
}
