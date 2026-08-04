import { useEffect, useMemo, useRef } from "react";
import { WheelButton } from "./wheel-button";
import { WheelCopySendActions } from "./wheel-copy-send-actions";
import { WheelLayout } from "./wheel-layout";
import type { WheelPrizeResult } from "./wheel-ui.types";
import { buildWheelShareMessage } from "./wheel-ui.share";

type WheelRestoredStepProps = {
  title: string;
  result: WheelPrizeResult;
  claimStatus?: "pending" | "submitted" | null;
  onClaim?: () => void;
  onReset: () => void;
  busy?: boolean;
  shareMessage?: string;
  vkUrl?: string;
  maxUrl?: string;
};

export function WheelRestoredStep({
  title,
  result,
  claimStatus = null,
  onClaim,
  onReset,
  busy,
  shareMessage,
  vkUrl,
  maxUrl,
}: WheelRestoredStepProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isSubmitted = claimStatus === "submitted";
  const showShare = isSubmitted && Boolean(vkUrl || maxUrl);

  const preparedText = useMemo(
    () =>
      shareMessage ??
      buildWheelShareMessage({
        result,
        selectedIntent: null,
        selectedZone: null,
      }),
    [shareMessage, result],
  );

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <WheelLayout
      title={title}
      phase="restored"
      compactHeader
      footer={
        <>
          {!isSubmitted && onClaim ? (
            <WheelButton
              onClick={onClaim}
              disabled={busy}
              data-testid="wheel-complete-button"
            >
              Получить подарок
            </WheelButton>
          ) : null}
          <WheelButton
            variant={isSubmitted ? "secondary" : "ghost"}
            onClick={onReset}
            data-testid="restored-reset"
          >
            Вернуться
          </WheelButton>
        </>
      }
    >
      <div className="flex flex-1 flex-col justify-center gap-4">
        <article
          className="rounded-[1.75rem] border border-[var(--wheel-gold)]/35 bg-[var(--wheel-cream)] p-5 sm:p-6"
          data-testid="restored-card"
          aria-live="polite"
        >
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--wheel-gold-deep)]">
            Сохранённый результат
          </p>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="mt-2 font-[family-name:var(--font-display)] text-[1.55rem] leading-tight text-[var(--wheel-ink)] outline-none"
          >
            Ваш подарок уже сохранён
          </h2>

          <p
            className="mt-3 break-words text-[15px] font-semibold text-[var(--wheel-ink)]"
            data-testid="wheel-prize-name"
          >
            {result.fullName}
          </p>

          {result.conditionText ? (
            <p className="mt-3 text-[14px] text-[var(--wheel-ink-soft)]">
              {result.conditionText}
            </p>
          ) : null}

          {result.validityDays ? (
            <p className="mt-2 text-[13px] text-[var(--wheel-muted)]">
              Срок действия — {result.validityDays} дней
            </p>
          ) : null}

          <p
            className="mt-4 rounded-xl bg-[var(--wheel-deep)]/5 px-3 py-2 text-[14px] font-medium text-[var(--wheel-ink)]"
            data-testid={
              isSubmitted ? "wheel-submitted-status" : "restored-status"
            }
          >
            {isSubmitted
              ? "Заявка уже отправлена"
              : "Вы уже выиграли подарок. Завершите получение."}
          </p>
          {isSubmitted ? (
            <div className="sr-only" data-testid="wheel-submitted">
              Заявка уже отправлена
            </div>
          ) : null}

          <p className="mt-3 text-[12px] text-[var(--wheel-muted)]">
            Это не новая попытка — показан ранее сохранённый результат.
          </p>
        </article>

        {showShare ? (
          <div
            className="rounded-[1.75rem] border border-[var(--wheel-gold)]/25 bg-[var(--wheel-cream)]/95 p-5 sm:p-6"
            data-testid="restored-share"
          >
            <p className="text-[15px] font-semibold text-[var(--wheel-ink)]">
              Хотите написать нам сами?
            </p>
            <p className="mt-2 text-[13px] text-[var(--wheel-ink-soft)]">
              Это необязательно. Заявка уже отправлена.
            </p>
            <pre
              className="mt-4 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-2xl bg-[var(--wheel-deep)]/[0.04] p-3 font-[family-name:var(--font-ui)] text-[12px] leading-relaxed text-[var(--wheel-ink-soft)]"
              data-testid="submitted-share-text"
            >
              {preparedText}
            </pre>
            <div className="mt-4">
              <WheelCopySendActions
                messageText={preparedText}
                vkUrl={vkUrl}
                maxUrl={maxUrl}
              />
            </div>
          </div>
        ) : null}
      </div>
    </WheelLayout>
  );
}
