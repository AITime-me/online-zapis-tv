"use client";

import { useEffect, useState } from "react";
import { NEW_SERVICE_CATEGORY_VALUE } from "@/lib/services/service-category";
import type {
  ServiceAdminRow,
  ServiceCategoryOption,
  ServiceMasterOption,
  ServiceWriteInput,
} from "@/types/service-admin";

type FormState = {
  internalName: string;
  publicName: string;
  clientDescription: string;
  categoryId: string;
  newCategoryName: string;
  priceFrom: string;
  priceTo: string;
  durationMinutes: string;
  breakAfterMinutes: string;
  sortOrder: string;
  isActive: boolean;
  isPublic: boolean;
  isOnlineBookingEnabled: boolean;
  masterIds: string[];
};

function getEnabledMasterIds(service?: ServiceAdminRow): string[] {
  if (!service) {
    return [];
  }
  return service.masters.filter((link) => link.isEnabled).map((link) => link.masterId);
}

function toFormState(
  service: ServiceAdminRow | undefined,
  categories: ServiceCategoryOption[],
): FormState {
  return {
    internalName: service?.internalName ?? "",
    publicName: service?.publicName ?? "",
    clientDescription: service?.clientDescription ?? "",
    categoryId: service?.categoryId ?? categories[0]?.id ?? "",
    newCategoryName: "",
    priceFrom:
      service?.priceFrom != null ? String(service.priceFrom) : "",
    priceTo: service?.priceTo != null ? String(service.priceTo) : "",
    durationMinutes: String(service?.durationMinutes ?? ""),
    breakAfterMinutes: String(service?.breakAfterMinutes ?? "0"),
    sortOrder: String(service?.sortOrder ?? "0"),
    isActive: service?.isActive ?? true,
    isPublic: service?.isPublic ?? true,
    isOnlineBookingEnabled: service?.isOnlineBookingEnabled ?? true,
    masterIds: getEnabledMasterIds(service),
  };
}

function toPayload(form: FormState): ServiceWriteInput {
  const isActive = form.isActive;
  const isNewCategory = form.categoryId === NEW_SERVICE_CATEGORY_VALUE;

  return {
    internalName: form.internalName,
    publicName: form.publicName,
    clientDescription: form.clientDescription || null,
    ...(isNewCategory
      ? { newCategoryName: form.newCategoryName.trim() }
      : { categoryId: form.categoryId }),
    priceFrom: form.priceFrom.trim() ? Number(form.priceFrom) : null,
    priceTo: form.priceTo.trim() ? Number(form.priceTo) : null,
    durationMinutes: Number(form.durationMinutes),
    breakAfterMinutes: form.breakAfterMinutes.trim()
      ? Number(form.breakAfterMinutes)
      : 0,
    sortOrder: form.sortOrder.trim() ? Number(form.sortOrder) : 0,
    isActive,
    isPublic: isActive ? form.isPublic : false,
    isOnlineBookingEnabled: isActive ? form.isOnlineBookingEnabled : false,
    masterIds: form.masterIds,
  };
}

const fieldClass =
  "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";
const labelClass = "text-xs font-medium text-zinc-700";

export function ServiceForm({
  service,
  categories,
  masters,
  onSaved,
  onCancel,
  onSaveStatus,
  mode = "edit",
}: {
  service?: ServiceAdminRow;
  categories: ServiceCategoryOption[];
  masters: ServiceMasterOption[];
  onSaved: (updated: ServiceAdminRow) => void;
  onCancel: () => void;
  onSaveStatus: (
    status: "idle" | "saving" | "saved" | "error",
    message?: string,
  ) => void;
  mode?: "edit" | "create";
}) {
  const isCreate = mode === "create" || !service;
  const [form, setForm] = useState<FormState>(() =>
    toFormState(service, categories),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(toFormState(service, categories));
  }, [service, categories]);

  const handleArchiveToggle = (isActive: boolean) => {
    setForm((current) => ({
      ...current,
      isActive,
      ...(isActive
        ? {}
        : {
            isPublic: false,
            isOnlineBookingEnabled: false,
          }),
    }));
  };

  const toggleMaster = (masterId: string) => {
    setForm((current) => {
      const selected = new Set(current.masterIds);
      if (selected.has(masterId)) {
        selected.delete(masterId);
      } else {
        selected.add(masterId);
      }
      return { ...current, masterIds: [...selected] };
    });
  };

  const handleSubmit = async () => {
    onSaveStatus("saving");
    setError(null);

    try {
      const payload = toPayload(form);
      const response = isCreate
        ? await fetch("/api/services", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/services/${service!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const result = await response.json();
      if (!response.ok || !result.ok || !result.service) {
        throw new Error(result.error ?? "Ошибка сохранения");
      }
      onSaveStatus("saved");
      onSaved(result.service);
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Ошибка сохранения";
      setError(message);
      onSaveStatus("error", message);
    }
  };

  return (
    <div className="rounded border border-[#dadce0] bg-white p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">
            {isCreate ? "Новая услуга" : "Редактирование услуги"}
          </h2>
          {!isCreate ? (
            <p className="mt-1 text-xs text-zinc-500">{service?.publicName}</p>
          ) : (
            <p className="mt-1 text-xs text-zinc-500">
              Заполните поля и сохраните — услуга появится в списке.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-zinc-500 hover:text-zinc-700"
        >
          Закрыть
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Внутреннее название</span>
          <input
            className={fieldClass}
            value={form.internalName}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                internalName: event.target.value,
              }))
            }
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Публичное название</span>
          <input
            className={fieldClass}
            value={form.publicName}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                publicName: event.target.value,
              }))
            }
          />
        </label>

        <label className="flex flex-col gap-1 md:col-span-2">
          <span className={labelClass}>Описание для клиента</span>
          <textarea
            className={`${fieldClass} min-h-20`}
            value={form.clientDescription}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                clientDescription: event.target.value,
              }))
            }
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Категория</span>
          <select
            className={fieldClass}
            value={form.categoryId}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                categoryId: event.target.value,
                ...(event.target.value === NEW_SERVICE_CATEGORY_VALUE
                  ? {}
                  : { newCategoryName: "" }),
              }))
            }
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
            <option value={NEW_SERVICE_CATEGORY_VALUE}>
              Добавить новую категорию…
            </option>
          </select>
        </label>

        {form.categoryId === NEW_SERVICE_CATEGORY_VALUE ? (
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className={labelClass}>Название новой категории</span>
            <input
              className={fieldClass}
              value={form.newCategoryName}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  newCategoryName: event.target.value,
                }))
              }
              placeholder="Например: Уход за кожей"
            />
          </label>
        ) : null}

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Порядок сортировки</span>
          <input
            type="number"
            className={fieldClass}
            value={form.sortOrder}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                sortOrder: event.target.value,
              }))
            }
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Цена от, ₽</span>
          <input
            type="number"
            min="0"
            step="0.01"
            className={fieldClass}
            value={form.priceFrom}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                priceFrom: event.target.value,
              }))
            }
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Цена до, ₽</span>
          <input
            type="number"
            min="0"
            step="0.01"
            className={fieldClass}
            value={form.priceTo}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                priceTo: event.target.value,
              }))
            }
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Длительность, мин</span>
          <input
            type="number"
            min="1"
            className={fieldClass}
            value={form.durationMinutes}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                durationMinutes: event.target.value,
              }))
            }
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Перерыв после, мин</span>
          <input
            type="number"
            min="0"
            className={fieldClass}
            value={form.breakAfterMinutes}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                breakAfterMinutes: event.target.value,
              }))
            }
          />
        </label>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => handleArchiveToggle(event.target.checked)}
          />
          Активна
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={form.isPublic}
            disabled={!form.isActive}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                isPublic: event.target.checked,
              }))
            }
          />
          Видна клиентам
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={form.isOnlineBookingEnabled}
            disabled={!form.isActive}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                isOnlineBookingEnabled: event.target.checked,
              }))
            }
          />
          Онлайн-запись
        </label>
      </div>

      {!form.isActive ? (
        <p className="mt-2 text-xs text-zinc-500">
          При архивации услуга скрывается от клиентов и отключается онлайн-запись.
        </p>
      ) : !form.isOnlineBookingEnabled ? (
        <p className="mt-2 text-xs text-zinc-500">
          Информационная услуга: активна, но без онлайн-записи (курс, цена за единицу и т.п.).
        </p>
      ) : null}

      <div className="mt-4">
        <p className={labelClass}>Мастера</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {masters.map((master) => (
            <label
              key={master.id}
              className={`flex items-center gap-2 rounded border px-2 py-1.5 text-sm ${
                master.isActive
                  ? "border-zinc-200 text-zinc-800"
                  : "border-zinc-100 text-zinc-400"
              }`}
            >
              <input
                type="checkbox"
                checked={form.masterIds.includes(master.id)}
                onChange={() => toggleMaster(master.id)}
              />
              <span>
                {master.internalName}
                {!master.isActive ? " (архив)" : ""}
              </span>
            </label>
          ))}
        </div>
      </div>

      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          className="rounded bg-[#1a73e8] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1557b0]"
        >
          Сохранить
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
