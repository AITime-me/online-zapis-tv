"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readApiJsonResponse } from "@/lib/api/read-json-response";
import { COMM_CTA_LINK_HINT } from "@/lib/communications/cta-link-policy";
import {
  COMM_BUTTON_STYLE_UI_LABELS,
  COMM_BUTTON_TYPE_HINTS,
  COMM_BUTTON_TYPE_UI_LABELS,
  COMM_MESSAGE_MAX_LENGTH,
  COMM_PREVIEW_DISCLAIMER,
  COMM_TEST_SEND_BLOCKED_REASON,
  COMM_LAUNCH_BLOCKED_REASON,
  DEFAULT_ATTRIBUTION_DAYS,
  DEFAULT_UNSUBSCRIBE_BUTTON_TEXT,
  STUDIO_TIMEZONE_LABEL,
  VK_MAX_MESSAGE_BUTTONS,
} from "@/lib/communications/composer-labels";
import type {
  CommCampaignButtonInput,
  CommCampaignCheckResult,
  CommCampaignDto,
  CommSegmentDto,
} from "@/types/communications";
import { COMM_CAMPAIGN_STATUS_LABELS } from "@/types/communications";

type FoundationLite = {
  bannerMessage: string;
  testSendBlockedReason?: string;
  settings?: {
    testContactId: string | null;
    testContact: { id: string; displayName: string | null; channel: string } | null;
  };
};

type ButtonForm = {
  localId: string;
  text: string;
  type: CommCampaignButtonInput["type"];
  action: string;
  url: string;
  style: NonNullable<CommCampaignButtonInput["style"]>;
  buttonKey?: string;
};

type AudienceBreakdown = {
  segmentTotal: number;
  eligible: number;
  excluded: number;
  exclusionReasons: Array<{ reason: string; label: string; count: number }>;
};

const fieldClass =
  "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";
const labelClass = "text-xs font-medium text-zinc-700";
const hintClass = "mt-0.5 text-xs text-zinc-500";

function newLocalId(): string {
  return `btn-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultButtons(): ButtonForm[] {
  return [
    {
      localId: newLocalId(),
      text: "Хочу",
      type: "REPLY_TEXT",
      action: "Хочу узнать подробнее о холодной плазме",
      url: "",
      style: "PRIMARY",
    },
    {
      localId: newLocalId(),
      text: "Выбрать время",
      type: "OPEN_LINK",
      action: "",
      url: "/booking",
      style: "POSITIVE",
    },
    {
      localId: newLocalId(),
      text: DEFAULT_UNSUBSCRIBE_BUTTON_TEXT,
      type: "UNSUBSCRIBE",
      action: "UNSUBSCRIBE",
      url: "",
      style: "NEGATIVE",
    },
  ];
}

function toApiButtons(buttons: ButtonForm[]): CommCampaignButtonInput[] {
  return buttons.map((button, index) => ({
    text: button.text,
    type: button.type,
    action: button.action || null,
    url: button.url || null,
    style: button.style,
    sortOrder: index,
    buttonKey: button.buttonKey,
  }));
}

function stylePreviewClass(style: string): string {
  switch (style) {
    case "PRIMARY":
      return "bg-sky-600 text-white";
    case "POSITIVE":
      return "bg-emerald-600 text-white";
    case "NEGATIVE":
      return "bg-rose-600 text-white";
    default:
      return "bg-zinc-200 text-zinc-900";
  }
}

export function CommunicationsComposer({
  foundation,
}: {
  foundation: FoundationLite;
}) {
  const [campaigns, setCampaigns] = useState<CommCampaignDto[]>([]);
  const [segments, setSegments] = useState<CommSegmentDto[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<CommCampaignCheckResult | null>(null);
  const [audience, setAudience] = useState<AudienceBreakdown | null>(null);
  const [previewMode, setPreviewMode] = useState<"mobile" | "compact">("mobile");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [form, setForm] = useState({
    name: "Рассказ об акции холодной плазмы",
    segmentId: "",
    messageText:
      "На первую процедуру холодной плазмы действует скидка 30%. Хотите узнать подробности?",
    mediaAssetId: null as string | null,
    mediaPreviewUrl: null as string | null,
    sendMode: "NOW" as "NOW" | "SCHEDULED",
    scheduleDate: "",
    scheduleTime: "",
    attributionDays: DEFAULT_ATTRIBUTION_DAYS,
    buttons: defaultButtons(),
  });

  const load = useCallback(async () => {
    const [campaignsRes, segmentsRes] = await Promise.all([
      fetch("/api/admin/communications/campaigns", { cache: "no-store" }),
      fetch("/api/admin/communications/segments", { cache: "no-store" }),
    ]);
    const campaignsData = await readApiJsonResponse<{
      ok: boolean;
      campaigns?: CommCampaignDto[];
      error?: string;
    }>(campaignsRes);
    const segmentsData = await readApiJsonResponse<{
      ok: boolean;
      segments?: CommSegmentDto[];
    }>(segmentsRes);
    if (!campaignsData.ok) {
      throw new Error(campaignsData.error || "Не удалось загрузить рассылки");
    }
    setCampaigns(campaignsData.campaigns ?? []);
    setSegments(segmentsData.segments ?? []);
    if (!form.segmentId && segmentsData.segments?.[0]) {
      setForm((current) => ({
        ...current,
        segmentId: segmentsData.segments![0]!.id,
      }));
    }
  }, [form.segmentId]);

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : "Ошибка загрузки"),
    );
  }, [load]);

  useEffect(() => {
    if (!form.segmentId) {
      setAudience(null);
      return;
    }
    void (async () => {
      const response = await fetch(
        `/api/admin/communications/segments/${form.segmentId}/audience`,
        { cache: "no-store" },
      );
      const data = await readApiJsonResponse<{
        ok: boolean;
        audience?: AudienceBreakdown;
      }>(response);
      if (data.ok && data.audience) {
        setAudience(data.audience);
      }
    })();
  }, [form.segmentId]);

  function loadCampaignIntoForm(campaign: CommCampaignDto) {
    setEditingId(campaign.id);
    setCheck(null);
    setForm({
      name: campaign.name,
      segmentId: campaign.segmentId ?? "",
      messageText: campaign.messageText,
      mediaAssetId: campaign.mediaAssetId,
      mediaPreviewUrl: campaign.mediaPreviewUrl,
      sendMode: campaign.sendMode === "SCHEDULED" ? "SCHEDULED" : "NOW",
      scheduleDate: campaign.scheduledAt
        ? campaign.scheduledAt.slice(0, 10)
        : "",
      scheduleTime: campaign.scheduledAt
        ? new Date(campaign.scheduledAt).toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "Asia/Yekaterinburg",
          })
        : "",
      attributionDays: campaign.attributionDays,
      buttons: campaign.buttons.map((button) => ({
        localId: button.id,
        text: button.text,
        type: button.type,
        action: button.action ?? "",
        url: button.url ?? "",
        style: button.style,
        buttonKey: button.buttonKey,
      })),
    });
    setStep(1);
  }

  async function uploadImage(file: File) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/admin/communications/media", {
        method: "POST",
        body,
      });
      const data = await readApiJsonResponse<{
        ok: boolean;
        asset?: { id: string };
        previewUrl?: string;
        error?: string;
      }>(response);
      if (!data.ok || !data.asset) {
        throw new Error(data.error || "Не удалось загрузить изображение");
      }
      setForm((current) => ({
        ...current,
        mediaAssetId: data.asset!.id,
        mediaPreviewUrl: data.previewUrl ?? null,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setBusy(false);
    }
  }

  async function removeImage() {
    if (!form.mediaAssetId) {
      return;
    }
    if (editingId && !window.confirm("Удалить изображение из рассылки?")) {
      return;
    }
    setBusy(true);
    try {
      if (editingId) {
        await fetch(`/api/admin/communications/campaigns/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clearMedia: true }),
        });
      }
      await fetch(`/api/admin/communications/media/${form.mediaAssetId}`, {
        method: "DELETE",
      });
      setForm((current) => ({
        ...current,
        mediaAssetId: null,
        mediaPreviewUrl: null,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка удаления");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        name: form.name,
        segmentId: form.segmentId || null,
        messageText: form.messageText,
        mediaAssetId: form.mediaAssetId,
        sendMode: form.sendMode,
        scheduleDate: form.scheduleDate || null,
        scheduleTime: form.scheduleTime || null,
        attributionDays: form.attributionDays,
        buttons: toApiButtons(form.buttons),
        status: "DRAFT" as const,
      };
      const response = await fetch(
        editingId
          ? `/api/admin/communications/campaigns/${editingId}`
          : "/api/admin/communications/campaigns",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await readApiJsonResponse<{
        ok: boolean;
        campaign?: CommCampaignDto;
        error?: string;
      }>(response);
      if (!data.ok || !data.campaign) {
        throw new Error(data.error || "Не удалось сохранить");
      }
      setEditingId(data.campaign.id);
      setForm((current) => ({
        ...current,
        buttons: data.campaign!.buttons.map((button) => ({
          localId: button.id,
          text: button.text,
          type: button.type,
          action: button.action ?? "",
          url: button.url ?? "",
          style: button.style,
          buttonKey: button.buttonKey,
        })),
        mediaPreviewUrl: data.campaign!.mediaPreviewUrl,
      }));
      setMessage("Черновик сохранён");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }

  async function runCheck() {
    if (!editingId) {
      await saveDraft();
    }
    const id = editingId;
    if (!id) {
      setError("Сначала сохраните черновик");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // ensure latest saved
      await fetch(`/api/admin/communications/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          segmentId: form.segmentId || null,
          messageText: form.messageText,
          mediaAssetId: form.mediaAssetId,
          sendMode: form.sendMode,
          scheduleDate: form.scheduleDate || null,
          scheduleTime: form.scheduleTime || null,
          attributionDays: form.attributionDays,
          buttons: toApiButtons(form.buttons),
        }),
      });
      const response = await fetch(
        `/api/admin/communications/campaigns/${id}/check`,
        { cache: "no-store" },
      );
      const data = await readApiJsonResponse<{
        ok: boolean;
        check?: CommCampaignCheckResult;
        error?: string;
      }>(response);
      if (!data.ok || !data.check) {
        throw new Error(data.error || "Не удалось проверить рассылку");
      }
      setCheck(data.check);
      setStep(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка проверки");
    } finally {
      setBusy(false);
    }
  }

  async function markReady() {
    if (!editingId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/communications/campaigns/${editingId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "READY" }),
        },
      );
      const data = await readApiJsonResponse<{ ok: boolean; error?: string }>(
        response,
      );
      if (!data.ok) {
        throw new Error(data.error || "Не удалось подготовить рассылку");
      }
      setMessage("Рассылка подготовлена (статус «Готова»). Запуск пока недоступен.");
      await load();
      await runCheck();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function tryTestSend() {
    if (!editingId) {
      return;
    }
    if (
      !window.confirm(
        "Отправить тестовое сообщение себе? Это станет доступно после подключения VK.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/communications/campaigns/${editingId}/test-send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: true }),
        },
      );
      const data = await readApiJsonResponse<{ ok: boolean; error?: string }>(
        response,
      );
      setError(data.error || COMM_TEST_SEND_BLOCKED_REASON);
    } catch (err) {
      setError(err instanceof Error ? err.message : COMM_TEST_SEND_BLOCKED_REASON);
    } finally {
      setBusy(false);
    }
  }

  const previewWidth = previewMode === "mobile" ? "max-w-[320px]" : "max-w-[420px]";

  const steps = useMemo(
    () =>
      [
        { id: 1 as const, label: "Получатели" },
        { id: 2 as const, label: "Сообщение" },
        { id: 3 as const, label: "Кнопки" },
        { id: 4 as const, label: "Время отправки" },
        { id: 5 as const, label: "Предпросмотр и проверка" },
      ] as const,
    [],
  );

  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-zinc-600">
        Создайте понятную рассылку для клиентов. Пока VK не подключён, можно
        сохранять черновики, проверять и готовить запуск — без реальной отправки.
      </p>

      <div className="flex flex-wrap gap-2">
        {steps.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setStep(item.id)}
            className={`rounded px-3 py-1.5 text-sm ${
              step === item.id
                ? "bg-zinc-900 text-white"
                : "bg-white text-zinc-800 ring-1 ring-zinc-300"
            }`}
          >
            {item.id}. {item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div className="space-y-4 rounded border border-zinc-200 bg-white p-4">
          {step === 1 ? (
            <div className="space-y-3">
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Название рассылки</span>
                <input
                  className={fieldClass}
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
                <span className={hintClass}>
                  Внутреннее название — клиенты его не видят.
                </span>
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Кому отправить</span>
                <select
                  className={fieldClass}
                  value={form.segmentId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      segmentId: event.target.value,
                    }))
                  }
                >
                  <option value="">Выберите сегмент</option>
                  {segments.map((segment) => (
                    <option key={segment.id} value={segment.id}>
                      {segment.name}
                    </option>
                  ))}
                </select>
              </label>
              {audience ? (
                <div className="rounded bg-zinc-50 px-3 py-2 text-sm">
                  <p>
                    Всего в сегменте: <strong>{audience.segmentTotal}</strong>
                  </p>
                  <p>
                    Разрешено к рассылке: <strong>{audience.eligible}</strong>
                  </p>
                  <p>
                    Исключено: <strong>{audience.excluded}</strong>
                  </p>
                  {audience.exclusionReasons.length > 0 ? (
                    <ul className="mt-2 list-disc pl-5 text-xs text-zinc-600">
                      {audience.exclusionReasons.map((item) => (
                        <li key={item.reason}>
                          {item.label}: {item.count}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-3">
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Текст сообщения</span>
                <textarea
                  className={fieldClass}
                  rows={6}
                  value={form.messageText}
                  maxLength={COMM_MESSAGE_MAX_LENGTH}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      messageText: event.target.value,
                    }))
                  }
                />
                <span className={hintClass}>
                  {form.messageText.length} / {COMM_MESSAGE_MAX_LENGTH}. Пишите
                  коротко и по делу — так удобнее читать в телефоне.
                </span>
              </label>
              <div>
                <span className={labelClass}>Изображение</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  <label className="cursor-pointer rounded bg-zinc-900 px-3 py-1.5 text-sm text-white">
                    Загрузить изображение
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void uploadImage(file);
                        }
                      }}
                    />
                  </label>
                  {form.mediaAssetId ? (
                    <button
                      type="button"
                      className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
                      onClick={() => void removeImage()}
                    >
                      Удалить изображение
                    </button>
                  ) : null}
                </div>
                <p className={hintClass}>
                  JPEG, PNG или WebP до 5 МБ. Метаданные удаляются автоматически.
                </p>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-3">
              {form.buttons.map((button, index) => (
                <div
                  key={button.localId}
                  className="space-y-2 rounded border border-zinc-100 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">Кнопка {index + 1}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="text-xs text-zinc-600"
                        disabled={index === 0}
                        onClick={() =>
                          setForm((current) => {
                            const buttons = [...current.buttons];
                            const tmp = buttons[index - 1]!;
                            buttons[index - 1] = buttons[index]!;
                            buttons[index] = tmp;
                            return { ...current, buttons };
                          })
                        }
                      >
                        Выше
                      </button>
                      <button
                        type="button"
                        className="text-xs text-zinc-600"
                        disabled={index >= form.buttons.length - 1}
                        onClick={() =>
                          setForm((current) => {
                            const buttons = [...current.buttons];
                            const tmp = buttons[index + 1]!;
                            buttons[index + 1] = buttons[index]!;
                            buttons[index] = tmp;
                            return { ...current, buttons };
                          })
                        }
                      >
                        Ниже
                      </button>
                      <button
                        type="button"
                        className="text-xs text-rose-700"
                        onClick={() => {
                          if (
                            editingId &&
                            !window.confirm("Удалить кнопку из рассылки?")
                          ) {
                            return;
                          }
                          setForm((current) => ({
                            ...current,
                            buttons: current.buttons.filter(
                              (_, i) => i !== index,
                            ),
                          }));
                        }}
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Тип</span>
                    <select
                      className={fieldClass}
                      value={button.type}
                      onChange={(event) => {
                        const type = event.target
                          .value as ButtonForm["type"];
                        setForm((current) => {
                          const buttons = [...current.buttons];
                          buttons[index] = {
                            ...buttons[index]!,
                            type,
                            style:
                              type === "UNSUBSCRIBE"
                                ? "NEGATIVE"
                                : type === "OPEN_LINK"
                                  ? "POSITIVE"
                                  : type === "REPLY_TEXT"
                                    ? "PRIMARY"
                                    : "SECONDARY",
                            text:
                              type === "UNSUBSCRIBE"
                                ? DEFAULT_UNSUBSCRIBE_BUTTON_TEXT
                                : buttons[index]!.text,
                          };
                          return { ...current, buttons };
                        });
                      }}
                    >
                      {Object.entries(COMM_BUTTON_TYPE_UI_LABELS).map(
                        ([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                    <span className={hintClass}>
                      {COMM_BUTTON_TYPE_HINTS[button.type]}
                    </span>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Надпись на кнопке</span>
                    <input
                      className={fieldClass}
                      value={button.text}
                      onChange={(event) =>
                        setForm((current) => {
                          const buttons = [...current.buttons];
                          buttons[index] = {
                            ...buttons[index]!,
                            text: event.target.value,
                          };
                          return { ...current, buttons };
                        })
                      }
                    />
                  </label>
                  {button.type === "REPLY_TEXT" ? (
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>Текст ответа</span>
                      <input
                        className={fieldClass}
                        value={button.action}
                        onChange={(event) =>
                          setForm((current) => {
                            const buttons = [...current.buttons];
                            buttons[index] = {
                              ...buttons[index]!,
                              action: event.target.value,
                            };
                            return { ...current, buttons };
                          })
                        }
                        placeholder="Хочу узнать подробнее о холодной плазме"
                      />
                    </label>
                  ) : null}
                  {button.type === "OPEN_LINK" ? (
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>Ссылка</span>
                      <input
                        className={fieldClass}
                        value={button.url}
                        onChange={(event) =>
                          setForm((current) => {
                            const buttons = [...current.buttons];
                            buttons[index] = {
                              ...buttons[index]!,
                              url: event.target.value,
                            };
                            return { ...current, buttons };
                          })
                        }
                        placeholder="/booking"
                      />
                      <span className={hintClass}>{COMM_CTA_LINK_HINT}</span>
                    </label>
                  ) : null}
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Внешний вид кнопки</span>
                    <select
                      className={fieldClass}
                      value={button.style}
                      onChange={(event) =>
                        setForm((current) => {
                          const buttons = [...current.buttons];
                          buttons[index] = {
                            ...buttons[index]!,
                            style: event.target.value as ButtonForm["style"],
                          };
                          return { ...current, buttons };
                        })
                      }
                    >
                      {Object.entries(COMM_BUTTON_STYLE_UI_LABELS).map(
                        ([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                </div>
              ))}
              <button
                type="button"
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
                disabled={form.buttons.length >= VK_MAX_MESSAGE_BUTTONS}
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    buttons: [
                      ...current.buttons,
                      {
                        localId: newLocalId(),
                        text: "Новая кнопка",
                        type: "REPLY_TEXT",
                        action: "",
                        url: "",
                        style: "SECONDARY",
                      },
                    ],
                  }))
                }
              >
                Добавить кнопку
              </button>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-3">
              <fieldset className="space-y-2">
                <legend className={labelClass}>Когда отправить</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={form.sendMode === "NOW"}
                    onChange={() =>
                      setForm((current) => ({ ...current, sendMode: "NOW" }))
                    }
                  />
                  Сейчас
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={form.sendMode === "SCHEDULED"}
                    onChange={() =>
                      setForm((current) => ({
                        ...current,
                        sendMode: "SCHEDULED",
                      }))
                    }
                  />
                  Выбрать дату и время
                </label>
              </fieldset>
              {form.sendMode === "SCHEDULED" ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Дата</span>
                    <input
                      type="date"
                      className={fieldClass}
                      value={form.scheduleDate}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          scheduleDate: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Время</span>
                    <input
                      type="time"
                      className={fieldClass}
                      value={form.scheduleTime}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          scheduleTime: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <p className={`${hintClass} sm:col-span-2`}>
                    {STUDIO_TIMEZONE_LABEL}
                  </p>
                </div>
              ) : null}
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Учитывать результаты рассылки</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={30}
                    className="w-24 rounded border border-zinc-300 px-2 py-1.5 text-sm"
                    value={form.attributionDays}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        attributionDays: Number(event.target.value) || 7,
                      }))
                    }
                  />
                  <span className="text-sm text-zinc-700">дней</span>
                </div>
                <span className={hintClass}>
                  Ответы, переходы, заявки и записи в течение этого периода будут
                  связаны с рассылкой
                </span>
              </label>
              <button
                type="button"
                className="text-sm text-zinc-600 underline"
                onClick={() => setShowAdvanced((value) => !value)}
              >
                {showAdvanced ? "Скрыть" : "Дополнительные настройки"}
              </button>
              {showAdvanced ? (
                <div className="rounded bg-zinc-50 p-3 text-xs text-zinc-600">
                  <p>
                    Тестовый получатель:{" "}
                    {foundation.settings?.testContact?.displayName ||
                      "не выбран"}
                  </p>
                  <p className="mt-1">{COMM_TEST_SEND_BLOCKED_REASON}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 5 ? (
            <div className="space-y-3 text-sm">
              {check ? (
                <>
                  <p>
                    <strong>{check.campaign.name}</strong> ·{" "}
                    {COMM_CAMPAIGN_STATUS_LABELS[check.campaign.status]}
                  </p>
                  <p>
                    Сегмент: {check.campaign.segmentName || "—"} · доступно{" "}
                    {check.audience.eligible}, исключено {check.audience.excluded}
                  </p>
                  <p>
                    Запуск:{" "}
                    {check.campaign.sendMode === "SCHEDULED"
                      ? `по расписанию (${check.studioTimezoneLabel})`
                      : "сейчас"}
                  </p>
                  <p>
                    Учёт результатов: {check.campaign.attributionDays} дн.
                  </p>
                  {check.linksWithUtm.length > 0 ? (
                    <ul className="list-disc pl-5 text-xs text-zinc-600">
                      {check.linksWithUtm.map((link) => (
                        <li key={link.url}>
                          {link.buttonText}: {link.url}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {check.issues.length > 0 ? (
                    <ul className="space-y-1 rounded border border-amber-200 bg-amber-50 p-3 text-amber-950">
                      {check.issues.map((issue) => (
                        <li key={issue.code}>{issue.message}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
                      Замечаний нет. Можно подготовить рассылку к запуску.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-zinc-500">
                  Нажмите «Проверить рассылку», чтобы увидеть итог перед запуском.
                </p>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-zinc-100 pt-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveDraft()}
              className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              Сохранить черновик
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runCheck()}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
            >
              Проверить рассылку
            </button>
            <button
              type="button"
              disabled
              title={COMM_TEST_SEND_BLOCKED_REASON}
              onClick={() => void tryTestSend()}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm opacity-50"
            >
              Отправить тест себе
            </button>
            <button
              type="button"
              disabled={busy || (check ? !check.canMarkReady : false)}
              onClick={() => void markReady()}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Подготовить к запуску
            </button>
            <button
              type="button"
              disabled
              title={COMM_LAUNCH_BLOCKED_REASON}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm opacity-50"
            >
              Запустить рассылку
            </button>
          </div>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
          <p className="text-xs text-zinc-500">{foundation.bannerMessage}</p>
        </div>

        <aside className="rounded border border-zinc-200 bg-zinc-50 p-4">
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              className={`rounded px-2 py-1 text-xs ${
                previewMode === "mobile" ? "bg-zinc-900 text-white" : "bg-white"
              }`}
              onClick={() => setPreviewMode("mobile")}
            >
              Мобильный вид
            </button>
            <button
              type="button"
              className={`rounded px-2 py-1 text-xs ${
                previewMode === "compact" ? "bg-zinc-900 text-white" : "bg-white"
              }`}
              onClick={() => setPreviewMode("compact")}
            >
              Компактный вид
            </button>
          </div>
          <div
            className={`mx-auto overflow-hidden rounded-2xl border border-zinc-300 bg-white shadow-sm ${previewWidth}`}
          >
            {form.mediaPreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.mediaPreviewUrl}
                alt=""
                className="max-h-48 w-full object-cover"
              />
            ) : (
              <div className="flex h-28 items-center justify-center bg-zinc-100 text-xs text-zinc-500">
                Нет изображения
              </div>
            )}
            <div className="space-y-3 p-3">
              <p className="whitespace-pre-wrap text-sm text-zinc-900">
                {form.messageText || "Текст сообщения появится здесь"}
              </p>
              <div className="space-y-2">
                {form.buttons.map((button) => (
                  <div
                    key={button.localId}
                    className={`rounded px-3 py-2 text-center text-sm ${stylePreviewClass(button.style)}`}
                  >
                    {button.text || "Кнопка"}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-zinc-500">{COMM_PREVIEW_DISCLAIMER}</p>
        </aside>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-900">Сохранённые рассылки</h3>
        {campaigns.map((campaign) => (
          <article
            key={campaign.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-200 bg-white px-3 py-2"
          >
            <div>
              <div className="font-medium text-zinc-900">{campaign.name}</div>
              <div className="text-xs text-zinc-500">
                {COMM_CAMPAIGN_STATUS_LABELS[campaign.status]} ·{" "}
                {campaign.segmentName || "без сегмента"}
              </div>
            </div>
            <button
              type="button"
              className="rounded border border-zinc-300 px-2 py-1 text-xs"
              onClick={() => loadCampaignIntoForm(campaign)}
            >
              Открыть
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
