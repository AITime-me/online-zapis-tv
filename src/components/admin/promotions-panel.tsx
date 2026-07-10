"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { readApiJsonResponse } from "@/lib/api/read-json-response";
import { getPromotionHomepageReadiness } from "@/lib/promotions/homepage-eligibility";
import {
  DISCOUNT_UNIT_LABELS,
  PROMOTION_SOURCE_LABELS,
  PROMOTION_STATUS_LABELS,
  PROMOTION_TYPE_LABELS,
  formatPromotionOffer,
  slugifyPromotionTitle,
  type DiscountUnitDto,
  type PromotionDto,
  type PromotionServiceOption,
  type PromotionSourceDto,
  type PromotionStatusDto,
  type PromotionTypeDto,
  type PromotionWriteInput,
} from "@/types/promotion-admin";

type SaveStatus = "idle" | "saving" | "saved" | "error";

type StatusFilter = "all" | PromotionStatusDto;
type TypeFilter = "all" | PromotionTypeDto;
type ActiveFilter = "all" | "yes" | "no";
type SourceFilter = "all" | PromotionSourceDto;

type FormState = {
  title: string;
  slug: string;
  shortDescription: string;
  description: string;
  type: PromotionTypeDto;
  status: PromotionStatusDto;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
  giftTitle: string;
  giftDescription: string;
  discountValue: string;
  discountUnit: DiscountUnitDto | "";
  discountDescription: string;
  conditions: string;
  ctaText: string;
  ctaLink: string;
  imageUrl: string;
  priority: string;
  source: PromotionSourceDto;
  showOnHomepage: boolean;
  serviceIds: string[];
};

const fieldClass =
  "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";
const labelClass = "text-xs font-medium text-zinc-700";
const filterClass =
  "rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900";

type PromotionApiPayload = {
  ok: boolean;
  promotion?: PromotionDto;
  error?: string;
};

async function parsePromotionResponse(
  response: Response,
): Promise<PromotionApiPayload> {
  try {
    return await readApiJsonResponse<PromotionApiPayload>(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка ответа сервера";
    throw new Error(message);
  }
}

function requirePromotionPayload(
  response: Response,
  payload: PromotionApiPayload,
  fallbackError: string,
): PromotionDto {
  if (!response.ok || !payload.ok || !payload.promotion) {
    throw new Error(payload.error ?? fallbackError);
  }
  return payload.promotion;
}

const TYPE_OPTIONS = Object.entries(PROMOTION_TYPE_LABELS) as Array<
  [PromotionTypeDto, string]
>;
const STATUS_OPTIONS = Object.entries(PROMOTION_STATUS_LABELS) as Array<
  [PromotionStatusDto, string]
>;
const SOURCE_OPTIONS = Object.entries(PROMOTION_SOURCE_LABELS) as Array<
  [PromotionSourceDto, string]
>;

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocalValue(value: string): string | null {
  if (!value.trim()) {
    return null;
  }
  return new Date(value).toISOString();
}

function formatPeriod(startsAt: string | null, endsAt: string | null): string {
  const format = (iso: string) =>
    new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  if (!startsAt && !endsAt) {
    return "Без ограничений";
  }
  if (startsAt && endsAt) {
    return `${format(startsAt)} — ${format(endsAt)}`;
  }
  if (startsAt) {
    return `с ${format(startsAt)}`;
  }
  return `до ${format(endsAt!)}`;
}

const DEFAULT_PROMOTION_PRIORITY = 100;

function sanitizePriorityDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function normalizePriorityInput(value: string): string {
  const digits = sanitizePriorityDigits(value);
  if (!digits) {
    return "";
  }
  return String(Number.parseInt(digits, 10));
}

function parsePriorityForSave(value: string): number {
  const normalized = normalizePriorityInput(value);
  if (!normalized) {
    return DEFAULT_PROMOTION_PRIORITY;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_PROMOTION_PRIORITY;
}

function emptyForm(): FormState {
  return {
    title: "",
    slug: "",
    shortDescription: "",
    description: "",
    type: "gift",
    status: "draft",
    isActive: false,
    startsAt: "",
    endsAt: "",
    giftTitle: "",
    giftDescription: "",
    discountValue: "",
    discountUnit: "percent",
    discountDescription: "",
    conditions: "",
    ctaText: "",
    ctaLink: "",
    imageUrl: "",
    priority: String(DEFAULT_PROMOTION_PRIORITY),
    source: "manual",
    showOnHomepage: false,
    serviceIds: [],
  };
}

function formFromPromotion(promotion: PromotionDto): FormState {
  return {
    title: promotion.title,
    slug: promotion.slug,
    shortDescription: promotion.shortDescription ?? "",
    description: promotion.description ?? "",
    type: promotion.type,
    status: promotion.status,
    isActive: promotion.isActive,
    startsAt: toDatetimeLocalValue(promotion.startsAt),
    endsAt: toDatetimeLocalValue(promotion.endsAt),
    giftTitle: promotion.giftTitle ?? "",
    giftDescription: promotion.giftDescription ?? "",
    discountValue:
      promotion.discountValue != null ? String(promotion.discountValue) : "",
    discountUnit: promotion.discountUnit ?? "percent",
    discountDescription: promotion.discountDescription ?? "",
    conditions: promotion.conditions ?? "",
    ctaText: promotion.ctaText ?? "",
    ctaLink: promotion.ctaLink ?? "",
    imageUrl: promotion.imageUrl ?? "",
    priority: String(promotion.priority),
    source: promotion.source,
    showOnHomepage: promotion.showOnHomepage,
    serviceIds: [...promotion.serviceIds],
  };
}

function formToWriteInput(form: FormState): PromotionWriteInput {
  const discountValue = form.discountValue.trim()
    ? Number(form.discountValue.replace(",", "."))
    : null;

  return {
    title: form.title,
    slug: form.slug,
    shortDescription: form.shortDescription || null,
    description: form.description || null,
    type: form.type,
    status: form.status,
    isActive: form.isActive,
    startsAt: fromDatetimeLocalValue(form.startsAt),
    endsAt: fromDatetimeLocalValue(form.endsAt),
    giftTitle: form.type === "discount" ? null : form.giftTitle || null,
    giftDescription:
      form.type === "discount" ? null : form.giftDescription || null,
    discountValue: form.type === "discount" ? discountValue : null,
    discountUnit:
      form.type === "discount" && discountValue != null
        ? (form.discountUnit || "percent")
        : null,
    discountDescription:
      form.type === "discount" ? form.discountDescription || null : null,
    conditions: form.conditions || null,
    ctaText: form.ctaText || null,
    ctaLink: form.ctaLink || null,
    imageUrl: form.imageUrl || null,
    priority: parsePriorityForSave(form.priority),
    source: form.source,
    showOnHomepage: form.showOnHomepage,
    serviceIds: form.serviceIds,
  };
}

function replacePromotion(
  promotions: PromotionDto[],
  updated: PromotionDto,
): PromotionDto[] {
  const exists = promotions.some((item) => item.id === updated.id);
  if (!exists) {
    return [updated, ...promotions];
  }
  return promotions.map((item) => (item.id === updated.id ? updated : item));
}

export function PromotionsPanel({
  initialPromotions,
  initialServices,
}: {
  initialPromotions: PromotionDto[];
  initialServices: PromotionServiceOption[];
}) {
  const router = useRouter();
  const [promotions, setPromotions] = useState(initialPromotions);
  const [services, setServices] = useState(initialServices);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [slugTouched, setSlugTouched] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  useEffect(() => {
    setPromotions(initialPromotions);
    setServices(initialServices);
  }, [initialPromotions, initialServices]);

  const filteredPromotions = useMemo(() => {
    const query = search.trim().toLowerCase();

    return promotions.filter((promotion) => {
      if (statusFilter !== "all" && promotion.status !== statusFilter) {
        return false;
      }
      if (typeFilter !== "all" && promotion.type !== typeFilter) {
        return false;
      }
      if (activeFilter === "yes" && !promotion.isActive) {
        return false;
      }
      if (activeFilter === "no" && promotion.isActive) {
        return false;
      }
      if (sourceFilter !== "all" && promotion.source !== sourceFilter) {
        return false;
      }
      if (query && !promotion.title.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  }, [promotions, search, statusFilter, typeFilter, activeFilter, sourceFilter]);

  const hasActiveFilters =
    search.trim() !== "" ||
    statusFilter !== "all" ||
    typeFilter !== "all" ||
    activeFilter !== "all" ||
    sourceFilter !== "all";

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setTypeFilter("all");
    setActiveFilter("all");
    setSourceFilter("all");
  };

  const startCreate = () => {
    setEditingId("new");
    setForm(emptyForm());
    setSlugTouched(false);
    setSaveStatus("idle");
    setSaveMessage(null);
  };

  const startEdit = (promotion: PromotionDto) => {
    setEditingId(promotion.id);
    setForm(formFromPromotion(promotion));
    setSlugTouched(true);
    setSaveStatus("idle");
    setSaveMessage(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm());
    setSlugTouched(false);
    setSaveStatus("idle");
    setSaveMessage(null);
  };

  const updateForm = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "title" && !slugTouched && typeof value === "string") {
        next.slug = slugifyPromotionTitle(value);
      }
      return next;
    });
  };

  const toggleService = (serviceId: string) => {
    setForm((current) => {
      const has = current.serviceIds.includes(serviceId);
      return {
        ...current,
        serviceIds: has
          ? current.serviceIds.filter((id) => id !== serviceId)
          : [...current.serviceIds, serviceId],
      };
    });
  };

  const savePromotion = async () => {
    setSaveStatus("saving");
    setSaveMessage(null);

    try {
      const body = formToWriteInput(form);
      const isNew = editingId === "new";
      const response = await fetch(
        isNew ? "/api/admin/promotions" : `/api/admin/promotions/${editingId}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = await parsePromotionResponse(response);
      const promotion = requirePromotionPayload(
        response,
        payload,
        "Ошибка сохранения",
      );

      setPromotions((current) => replacePromotion(current, promotion));
      setEditingId(promotion.id);
      setForm(formFromPromotion(promotion));
      setSlugTouched(true);
      setSaveStatus("saved");
      router.refresh();
      window.setTimeout(() => setSaveStatus("idle"), 1500);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка сохранения";
      setSaveStatus("error");
      setSaveMessage(text);
    }
  };

  const toggleActive = async (promotion: PromotionDto) => {
    if (promotion.status === "archived") {
      return;
    }

    setActionId(promotion.id);
    try {
      const response = await fetch(`/api/admin/promotions/${promotion.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !promotion.isActive }),
      });
      const payload = await parsePromotionResponse(response);
      const updatedPromotion = requirePromotionPayload(
        response,
        payload,
        "Не удалось изменить активность",
      );
      setPromotions((current) => replacePromotion(current, updatedPromotion));
      if (editingId === updatedPromotion.id) {
        setForm(formFromPromotion(updatedPromotion));
      }
      router.refresh();
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "Не удалось изменить активность";
      setSaveStatus("error");
      setSaveMessage(text);
    } finally {
      setActionId(null);
    }
  };

  const restoreFromArchive = async (promotion: PromotionDto) => {
    setActionId(promotion.id);
    try {
      const response = await fetch(`/api/admin/promotions/${promotion.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restoreFromArchive: true }),
      });
      const payload = await parsePromotionResponse(response);
      const updatedPromotion = requirePromotionPayload(
        response,
        payload,
        "Не удалось вернуть из архива",
      );
      setPromotions((current) => replacePromotion(current, updatedPromotion));
      if (editingId === updatedPromotion.id) {
        setForm(formFromPromotion(updatedPromotion));
      }
      router.refresh();
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "Не удалось вернуть из архива";
      setSaveStatus("error");
      setSaveMessage(text);
    } finally {
      setActionId(null);
    }
  };

  const archivePromotion = async (promotion: PromotionDto) => {
    if (
      !window.confirm(
        `Переместить акцию «${promotion.title}» в архив? Она перестанет отображаться публично.`,
      )
    ) {
      return;
    }

    setActionId(promotion.id);
    try {
      const response = await fetch(`/api/admin/promotions/${promotion.id}`, {
        method: "DELETE",
      });
      const payload = await parsePromotionResponse(response);
      const updatedPromotion = requirePromotionPayload(
        response,
        payload,
        "Не удалось архивировать",
      );
      setPromotions((current) => replacePromotion(current, updatedPromotion));
      if (editingId === updatedPromotion.id) {
        setForm(formFromPromotion(updatedPromotion));
      }
      router.refresh();
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "Не удалось архивировать";
      setSaveStatus("error");
      setSaveMessage(text);
    } finally {
      setActionId(null);
    }
  };

  const statusLabel =
    saveStatus === "saving"
      ? "Сохраняю..."
      : saveStatus === "saved"
        ? "Сохранено"
        : saveStatus === "error"
          ? `Ошибка${saveMessage ? `: ${saveMessage}` : ""}`
          : null;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-end gap-3 rounded border border-zinc-200 bg-white p-4">
        <label className="flex min-w-[180px] flex-1 flex-col gap-1">
          <span className={labelClass}>Поиск по названию</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Например, подарок"
            className={filterClass}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Статус</span>
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as StatusFilter)
            }
            className={filterClass}
          >
            <option value="all">Все</option>
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Тип</span>
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
            className={filterClass}
          >
            <option value="all">Все</option>
            {TYPE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Активность</span>
          <select
            value={activeFilter}
            onChange={(event) =>
              setActiveFilter(event.target.value as ActiveFilter)
            }
            className={filterClass}
          >
            <option value="all">Все</option>
            <option value="yes">Включена</option>
            <option value="no">Выключена</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Источник</span>
          <select
            value={sourceFilter}
            onChange={(event) =>
              setSourceFilter(event.target.value as SourceFilter)
            }
            className={filterClass}
          >
            <option value="all">Все</option>
            {SOURCE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={resetFilters}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Сбросить фильтры
          </button>
        ) : null}

        <button
          type="button"
          onClick={startCreate}
          className="ml-auto rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Создать акцию
        </button>
      </section>

      {promotions.length === 0 ? (
        <section className="rounded border border-dashed border-zinc-300 bg-zinc-50 px-6 py-10 text-center">
          <p className="text-sm text-zinc-600">
            Пока нет созданных акций. Здесь можно будет управлять подарками,
            сезонными предложениями и акциями для игры.
          </p>
          <button
            type="button"
            onClick={startCreate}
            className="mt-4 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Создать акцию
          </button>
        </section>
      ) : filteredPromotions.length === 0 ? (
        <section className="rounded border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-600">
          {statusFilter === "archived"
            ? "В архиве пока нет акций."
            : "По выбранным фильтрам акций не найдено."}
        </section>
      ) : (
        <section className="overflow-x-auto rounded border border-zinc-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">Название</th>
                <th className="px-3 py-2">Тип</th>
                <th className="px-3 py-2">Статус</th>
                <th className="px-3 py-2">Активна</th>
                <th className="px-3 py-2">Период</th>
                <th className="px-3 py-2">Предложение</th>
                <th className="px-3 py-2">Источник</th>
                <th className="px-3 py-2">Приоритет</th>
                <th className="px-3 py-2">Действия</th>
              </tr>
            </thead>
            <tbody>
              {filteredPromotions.map((promotion) => (
                <tr key={promotion.id} className="border-b border-zinc-100">
                  <td className="px-3 py-3 font-medium text-zinc-900">
                    {promotion.title}
                  </td>
                  <td className="px-3 py-3">
                    {PROMOTION_TYPE_LABELS[promotion.type]}
                  </td>
                  <td className="px-3 py-3">
                    {PROMOTION_STATUS_LABELS[promotion.status]}
                  </td>
                  <td className="px-3 py-3">
                    {promotion.isActive ? "Да" : "Нет"}
                  </td>
                  <td className="px-3 py-3 text-zinc-600">
                    {formatPeriod(promotion.startsAt, promotion.endsAt)}
                  </td>
                  <td className="px-3 py-3 text-zinc-600">
                    {formatPromotionOffer(promotion)}
                  </td>
                  <td className="px-3 py-3">
                    {PROMOTION_SOURCE_LABELS[promotion.source]}
                  </td>
                  <td className="px-3 py-3">{promotion.priority}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(promotion)}
                        className="text-xs text-blue-700 hover:underline"
                      >
                        Редактировать
                      </button>
                      {promotion.status === "archived" ? (
                        <button
                          type="button"
                          disabled={actionId === promotion.id}
                          onClick={() => restoreFromArchive(promotion)}
                          className="text-xs text-emerald-800 hover:underline disabled:opacity-50"
                        >
                          Вернуть из архива
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={actionId === promotion.id}
                            onClick={() => toggleActive(promotion)}
                            className="text-xs text-zinc-700 hover:underline disabled:opacity-50"
                          >
                            {promotion.isActive ? "Выключить" : "Включить"}
                          </button>
                          <button
                            type="button"
                            disabled={actionId === promotion.id}
                            onClick={() => archivePromotion(promotion)}
                            className="text-xs text-amber-800 hover:underline disabled:opacity-50"
                          >
                            В архив
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {editingId ? (
        <section className="rounded border border-zinc-200 bg-white p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-zinc-900">
              {editingId === "new" ? "Новая акция" : "Редактирование акции"}
            </h2>
            <div className="flex items-center gap-3">
              {statusLabel ? (
                <span className="text-sm text-zinc-500">{statusLabel}</span>
              ) : null}
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700"
              >
                Закрыть
              </button>
              <button
                type="button"
                onClick={savePromotion}
                disabled={saveStatus === "saving"}
                className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                Сохранить
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className={labelClass}>Название акции</span>
              <input
                value={form.title}
                onChange={(event) => updateForm("title", event.target.value)}
                className={fieldClass}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className={labelClass}>Slug</span>
              <input
                value={form.slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  updateForm("slug", event.target.value);
                }}
                className={fieldClass}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className={labelClass}>Приоритет</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={form.priority}
                onChange={(event) =>
                  updateForm("priority", sanitizePriorityDigits(event.target.value))
                }
                onBlur={() =>
                  setForm((current) => ({
                    ...current,
                    priority: normalizePriorityInput(current.priority),
                  }))
                }
                placeholder={String(DEFAULT_PROMOTION_PRIORITY)}
                className={fieldClass}
              />
              <p className="text-xs leading-relaxed text-zinc-500">
                Чем меньше число, тем выше акция в списке. Например: 10 — главная,
                20 — ниже, 30 — ещё ниже.
              </p>
              <p className="text-xs leading-relaxed text-zinc-500">
                10 — игра · 20 — консультация · 30 — текущая акция · 50+ —
                дополнительные предложения
              </p>
            </label>

            <label className="flex flex-col gap-1">
              <span className={labelClass}>Тип акции</span>
              <select
                value={form.type}
                onChange={(event) =>
                  updateForm("type", event.target.value as PromotionTypeDto)
                }
                className={fieldClass}
              >
                {TYPE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className={labelClass}>Статус</span>
              <select
                value={form.status}
                onChange={(event) =>
                  updateForm("status", event.target.value as PromotionStatusDto)
                }
                className={fieldClass}
              >
                {STATUS_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className={labelClass}>Источник акции</span>
              <select
                value={form.source}
                onChange={(event) =>
                  updateForm("source", event.target.value as PromotionSourceDto)
                }
                className={fieldClass}
              >
                {SOURCE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                checked={form.isActive}
                disabled={form.status === "archived"}
                onChange={(event) => updateForm("isActive", event.target.checked)}
              />
              <span className={labelClass}>
                Активна
                {form.status === "archived"
                  ? " (недоступно для архивной акции)"
                  : null}
              </span>
            </label>

            <label className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                checked={form.showOnHomepage}
                disabled={form.status === "archived"}
                onChange={(event) =>
                  updateForm("showOnHomepage", event.target.checked)
                }
              />
              <span className={labelClass}>Показывать на главной странице</span>
            </label>

            {form.showOnHomepage ? (
              <div className="lg:col-span-2">
                {(() => {
                  const readiness = getPromotionHomepageReadiness({
                    title: form.title,
                    shortDescription: form.shortDescription || null,
                    description: form.description || null,
                    ctaText: form.ctaText || null,
                    ctaLink: form.ctaLink || null,
                    imageUrl: form.imageUrl || null,
                    status: form.status,
                    isActive: form.isActive,
                    showOnHomepage: form.showOnHomepage,
                    startsAt: fromDatetimeLocalValue(form.startsAt),
                    endsAt: fromDatetimeLocalValue(form.endsAt),
                  });

                  if (readiness.eligible) {
                    return (
                      <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                        Акция готова к показу в карусели главной страницы.
                      </p>
                    );
                  }

                  return (
                    <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      Для показа на главной не хватает:{" "}
                      {readiness.missing.join(", ")}.
                    </p>
                  );
                })()}
              </div>
            ) : null}

            <label className="flex flex-col gap-1">
              <span className={labelClass}>Дата начала</span>
              <input
                type="datetime-local"
                value={form.startsAt}
                onChange={(event) => updateForm("startsAt", event.target.value)}
                className={fieldClass}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className={labelClass}>Дата окончания</span>
              <input
                type="datetime-local"
                value={form.endsAt}
                onChange={(event) => updateForm("endsAt", event.target.value)}
                className={fieldClass}
              />
            </label>

            <label className="flex flex-col gap-1 md:col-span-2">
              <span className={labelClass}>Короткое описание</span>
              <input
                value={form.shortDescription}
                onChange={(event) =>
                  updateForm("shortDescription", event.target.value)
                }
                className={fieldClass}
              />
            </label>

            <label className="flex flex-col gap-1 md:col-span-2">
              <span className={labelClass}>Подробное описание</span>
              <textarea
                value={form.description}
                onChange={(event) => updateForm("description", event.target.value)}
                rows={4}
                className={fieldClass}
              />
            </label>

            {form.type === "discount" ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>Размер скидки</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.discountValue}
                    onChange={(event) =>
                      updateForm("discountValue", event.target.value)
                    }
                    className={fieldClass}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className={labelClass}>Единица скидки</span>
                  <select
                    value={form.discountUnit}
                    onChange={(event) =>
                      updateForm(
                        "discountUnit",
                        event.target.value as DiscountUnitDto,
                      )
                    }
                    className={fieldClass}
                  >
                    <option value="percent">{DISCOUNT_UNIT_LABELS.percent}</option>
                    <option value="fixed">{DISCOUNT_UNIT_LABELS.fixed}</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 md:col-span-2">
                  <span className={labelClass}>Описание скидки</span>
                  <textarea
                    value={form.discountDescription}
                    onChange={(event) =>
                      updateForm("discountDescription", event.target.value)
                    }
                    rows={3}
                    className={fieldClass}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>Название подарка / бонуса</span>
                  <input
                    value={form.giftTitle}
                    onChange={(event) => updateForm("giftTitle", event.target.value)}
                    className={fieldClass}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className={labelClass}>Текст кнопки</span>
                  <input
                    value={form.ctaText}
                    onChange={(event) => updateForm("ctaText", event.target.value)}
                    className={fieldClass}
                  />
                </label>

                <label className="flex flex-col gap-1 md:col-span-2">
                  <span className={labelClass}>Описание подарка / бонуса</span>
                  <textarea
                    value={form.giftDescription}
                    onChange={(event) =>
                      updateForm("giftDescription", event.target.value)
                    }
                    rows={3}
                    className={fieldClass}
                  />
                </label>
              </>
            )}

            {form.type === "discount" ? (
              <label className="flex flex-col gap-1 md:col-span-2">
                <span className={labelClass}>Текст кнопки</span>
                <input
                  value={form.ctaText}
                  onChange={(event) => updateForm("ctaText", event.target.value)}
                  className={fieldClass}
                />
              </label>
            ) : null}

            <label className="flex flex-col gap-1 md:col-span-2">
              <span className={labelClass}>Условия получения</span>
              <textarea
                value={form.conditions}
                onChange={(event) => updateForm("conditions", event.target.value)}
                rows={3}
                className={fieldClass}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className={labelClass}>Ссылка кнопки</span>
              <input
                value={form.ctaLink}
                onChange={(event) => updateForm("ctaLink", event.target.value)}
                className={fieldClass}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className={labelClass}>Изображение (URL)</span>
              <input
                value={form.imageUrl}
                onChange={(event) => updateForm("imageUrl", event.target.value)}
                className={fieldClass}
              />
            </label>

            <div className="flex flex-col gap-2 md:col-span-2">
              <span className={labelClass}>
                Привязанные услуги (пусто = общая акция)
              </span>
              {services.length === 0 ? (
                <p className="text-sm text-zinc-500">Нет активных услуг</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {services.map((service) => (
                    <label
                      key={service.id}
                      className="flex items-start gap-2 rounded border border-zinc-200 px-2 py-1.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={form.serviceIds.includes(service.id)}
                        onChange={() => toggleService(service.id)}
                        className="mt-0.5"
                      />
                      <span>{service.publicName}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
