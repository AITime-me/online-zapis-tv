"use client";

import {
  BOT_LAUNCH_STATUS_DISCLAIMER,
  BOT_LAUNCH_STATUS_KIND_LABELS,
  BOT_LAUNCH_STATUS_ITEMS,
  groupBotLaunchStatusItems,
  type BotLaunchStatusKind,
} from "@/lib/bot-settings/launch-status";

const KIND_ORDER: BotLaunchStatusKind[] = [
  "not_connected",
  "partial",
  "not_implemented",
  "needs_runtime_check",
];

/**
 * Compact development/connection checklist.
 * Explicitly not live health and not AUTO readiness.
 */
export function BotLaunchStatusPanel() {
  const groups = groupBotLaunchStatusItems(BOT_LAUNCH_STATUS_ITEMS);

  return (
    <details className="rounded border border-zinc-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-zinc-900">
        Этап запуска / ещё требуется
        <span className="ml-2 font-normal text-zinc-500">
          ({BOT_LAUNCH_STATUS_ITEMS.length})
        </span>
      </summary>
      <p className="mt-2 text-xs text-amber-900">{BOT_LAUNCH_STATUS_DISCLAIMER}</p>
      <div className="mt-3 space-y-4">
        {KIND_ORDER.map((kind) => {
          const items = groups[kind];
          if (items.length === 0) {
            return null;
          }
          return (
            <div key={kind}>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {BOT_LAUNCH_STATUS_KIND_LABELS[kind]}
              </p>
              <ul className="mt-1 space-y-1.5">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-700"
                  >
                    <span className="font-medium text-zinc-900">
                      {item.label}
                    </span>
                    <span className="ml-2 text-zinc-500">
                      · {BOT_LAUNCH_STATUS_KIND_LABELS[item.kind]}
                    </span>
                    {item.detail ? (
                      <span className="mt-0.5 block text-zinc-600">
                        {item.detail}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </details>
  );
}
