import { useState } from "react";
import { WheelButton } from "./wheel-button";
import { copyAndOpenUrl } from "./wheel-ui.share";

export type WheelCopySendActionsProps = {
  messageText: string;
  vkUrl?: string;
  maxUrl?: string;
  onStatusChange?: (status: string | null) => void;
};

/**
 * Optional post-success messenger actions.
 * Production URLs must be passed via props — nothing is hardcoded.
 */
export function WheelCopySendActions({
  messageText,
  vkUrl,
  maxUrl,
  onStatusChange,
}: WheelCopySendActionsProps) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const hasVk = Boolean(vkUrl);
  const hasMax = Boolean(maxUrl);

  if (!hasVk && !hasMax) {
    return null;
  }

  const setStatus = (status: string) => {
    setCopyStatus(status);
    onStatusChange?.(status);
  };

  const handleCopyOpen = async (url: string, channel: "VK" | "MAX") => {
    const copied = await copyAndOpenUrl(messageText, url);
    setStatus(
      copied
        ? `Текст скопирован — вставьте его в чат ${channel}.`
        : `Не удалось скопировать автоматически. Скопируйте текст вручную и откройте ${channel}.`,
    );
  };

  return (
    <div className="flex flex-col gap-2.5" data-testid="wheel-copy-send-actions">
      {copyStatus ? (
        <p
          className="text-[13px] text-[var(--wheel-ink-soft)]"
          role="status"
          data-testid="copy-status"
        >
          {copyStatus}
        </p>
      ) : null}
      {hasVk ? (
        <WheelButton
          variant="secondaryLight"
          onClick={() => {
            void handleCopyOpen(vkUrl!, "VK");
          }}
          data-testid="copy-open-vk"
        >
          Скопировать текст и открыть VK
        </WheelButton>
      ) : null}
      {hasMax ? (
        <WheelButton
          variant="secondaryLight"
          onClick={() => {
            void handleCopyOpen(maxUrl!, "MAX");
          }}
          data-testid="copy-open-max"
        >
          Скопировать текст и открыть MAX
        </WheelButton>
      ) : null}
    </div>
  );
}
