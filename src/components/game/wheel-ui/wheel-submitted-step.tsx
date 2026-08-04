import { useEffect, useMemo, useRef } from "react";
import { WheelButton } from "./wheel-button";
import { WheelCopySendActions } from "./wheel-copy-send-actions";
import { WheelLayout } from "./wheel-layout";
import type {
  WheelPrizeResult,
  WheelProcedureIntent,
  WheelZone,
} from "./wheel-ui.types";
import { buildWheelShareMessage } from "./wheel-ui.share";

type WheelSubmittedStepProps = {
  title: string;
  result: WheelPrizeResult;
  selectedIntent?: WheelProcedureIntent | null;
  selectedZone?: WheelZone | null;
  shareMessage?: string;
  vkUrl?: string;
  maxUrl?: string;
  onReset: () => void;
};

export function WheelSubmittedStep({
  title,
  result,
  selectedIntent = null,
  selectedZone = null,
  shareMessage,
  vkUrl,
  maxUrl,
  onReset,
}: WheelSubmittedStepProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  const preparedText = useMemo(
    () =>
      shareMessage ??
      buildWheelShareMessage({
        result,
        selectedIntent,
        selectedZone,
      }),
    [shareMessage, result, selectedIntent, selectedZone],
  );

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <WheelLayout
      title={title}
      phase="submitted"
      compactHeader
      footer={
        <WheelButton
          variant="ghost"
          onClick={onReset}
          data-testid="submitted-reset"
        >
          Вернуться в начало
        </WheelButton>
      }
    >
      <div
        className="flex flex-1 flex-col justify-center gap-4 overflow-y-auto pb-2"
        data-testid="wheel-submitted"
      >
        <article
          className="rounded-[1.75rem] border border-[var(--wheel-gold)]/35 bg-[var(--wheel-cream)] p-5 sm:p-6"
          data-testid="submitted-card"
          aria-live="polite"
        >
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--wheel-gold-deep)]">
            Готово
          </p>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="mt-2 font-[family-name:var(--font-display)] text-[1.6rem] leading-tight text-[var(--wheel-ink)] outline-none"
          >
            Заявка отправлена
          </h2>
          <p
            className="mt-3 break-words text-[15px] font-semibold text-[var(--wheel-ink)]"
            data-testid="submitted-prize-name"
          >
            {result.fullName}
          </p>
          <p
            className="mt-3 text-[14px] leading-relaxed text-[var(--wheel-ink-soft)]"
            data-testid="wheel-submitted-status"
          >
            Подарок сохранён за вами. Менеджер студии свяжется с вами по
            указанному номеру телефона.
          </p>
          <p className="mt-3 text-[14px] font-medium text-[var(--wheel-ink)]">
            Больше ничего делать не нужно.
          </p>
        </article>

        {(vkUrl || maxUrl) && (
          <div className="rounded-[1.75rem] border border-[var(--wheel-gold)]/25 bg-[var(--wheel-cream)]/95 p-5 sm:p-6">
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
        )}
      </div>
    </WheelLayout>
  );
}
