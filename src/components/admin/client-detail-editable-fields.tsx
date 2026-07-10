"use client";

import { useState, type ReactNode } from "react";
import { readApiJsonResponse } from "@/lib/api/read-json-response";
import {
  CLIENT_STATUSES,
  getClientStatusLabel,
} from "@/lib/clients/defaults";
import { ClientTagBadge } from "@/components/admin/client-tag-badges";
import { ClientTagsInlineEditor } from "@/components/admin/client-tags-inline-editor";
import type { ClientAdminDto } from "@/types/client-admin";
import type { ClientDetailClientDto } from "@/types/client-detail";

type EditableField =
  | "fullName"
  | "phone"
  | "email"
  | "source"
  | "birthDate"
  | "gender"
  | "loyaltyLevel"
  | "notes"
  | "status";

type ClientDetailEditableFieldsProps = {
  client: ClientDetailClientDto;
  canEdit: boolean;
  onClientChange: (patch: Partial<ClientDetailClientDto>) => void;
};

const fieldClass =
  "w-full rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-900";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Yekaterinburg",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function InlineField({
  label,
  value,
  displayValue,
  editing,
  canEdit,
  onStartEdit,
  onCancel,
  onSave,
  saving,
  error,
  children,
}: {
  label: string;
  value: string;
  displayValue?: string;
  editing: boolean;
  canEdit: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  children: ReactNode;
}) {
  const shown = displayValue ?? (value || "—");

  if (!canEdit) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-zinc-500">{label}</p>
        <p className="text-sm text-zinc-900">{shown}</p>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-zinc-500">{label}</p>
        <button
          type="button"
          onClick={onStartEdit}
          className="group w-full rounded border border-transparent px-1 py-0.5 text-left text-sm text-zinc-900 hover:border-zinc-200 hover:bg-zinc-50"
        >
          <span>{shown}</span>
          <span className="ml-2 text-[10px] text-zinc-400 opacity-0 group-hover:opacity-100">
            Изменить
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1 rounded border border-zinc-200 bg-zinc-50 p-2">
      <p className="text-xs font-medium text-zinc-700">{label}</p>
      {children}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded bg-zinc-900 px-2 py-1 text-xs text-white disabled:opacity-60"
        >
          {saving ? "Сохраняю…" : "Сохранить"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}

export function ClientDetailEditableFields({
  client,
  canEdit,
  onClientChange,
}: ClientDetailEditableFieldsProps) {
  const [activeField, setActiveField] = useState<EditableField | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editable = canEdit && !client.mergedIntoClientId;

  const startEdit = (field: EditableField, currentValue: string) => {
    setActiveField(field);
    setDraft(currentValue);
    setError(null);
  };

  const cancelEdit = () => {
    setActiveField(null);
    setDraft("");
    setError(null);
  };

  const patchClient = async (body: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await readApiJsonResponse<{
        ok: boolean;
        client?: ClientAdminDto;
        error?: string;
      }>(response);
      if (!response.ok || !payload.ok || !payload.client) {
        throw new Error(payload.error ?? "Не удалось сохранить");
      }
      onClientChange(payload.client);
      setActiveField(null);
      setDraft("");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Не удалось сохранить",
      );
    } finally {
      setSaving(false);
    }
  };

  const saveField = async (field: EditableField) => {
    await patchClient({ [field]: draft });
  };

  return (
    <>
      <div className="mt-4">
        <InlineField
          label="ФИО"
          value={client.fullName}
          editing={activeField === "fullName"}
          canEdit={editable}
          onStartEdit={() => startEdit("fullName", client.fullName)}
          onCancel={cancelEdit}
          onSave={() => void saveField("fullName")}
          saving={saving}
          error={activeField === "fullName" ? error : null}
        >
          <input
            className={fieldClass}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </InlineField>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <InlineField
          label="Телефон"
          value={client.phone ?? ""}
          editing={activeField === "phone"}
          canEdit={editable}
          onStartEdit={() => startEdit("phone", client.phone ?? "")}
          onCancel={cancelEdit}
          onSave={() => void saveField("phone")}
          saving={saving}
          error={activeField === "phone" ? error : null}
        >
          <input
            className={fieldClass}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="+7 900 000-00-00"
          />
        </InlineField>

        <InlineField
          label="Email"
          value={client.email ?? ""}
          editing={activeField === "email"}
          canEdit={editable}
          onStartEdit={() => startEdit("email", client.email ?? "")}
          onCancel={cancelEdit}
          onSave={() => void saveField("email")}
          saving={saving}
          error={activeField === "email" ? error : null}
        >
          <input
            className={fieldClass}
            type="email"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </InlineField>

        <InlineField
          label="Источник"
          value={client.source ?? ""}
          editing={activeField === "source"}
          canEdit={editable}
          onStartEdit={() => startEdit("source", client.source ?? "")}
          onCancel={cancelEdit}
          onSave={() => void saveField("source")}
          saving={saving}
          error={activeField === "source" ? error : null}
        >
          <input
            className={fieldClass}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </InlineField>

        <InlineField
          label="Дата рождения"
          value={client.birthDate ?? ""}
          displayValue={formatDate(client.birthDate)}
          editing={activeField === "birthDate"}
          canEdit={editable}
          onStartEdit={() => startEdit("birthDate", client.birthDate ?? "")}
          onCancel={cancelEdit}
          onSave={() => void saveField("birthDate")}
          saving={saving}
          error={activeField === "birthDate" ? error : null}
        >
          <input
            className={fieldClass}
            type="date"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </InlineField>

        <InlineField
          label="Пол"
          value={client.gender ?? ""}
          editing={activeField === "gender"}
          canEdit={editable}
          onStartEdit={() => startEdit("gender", client.gender ?? "")}
          onCancel={cancelEdit}
          onSave={() => void saveField("gender")}
          saving={saving}
          error={activeField === "gender" ? error : null}
        >
          <input
            className={fieldClass}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </InlineField>

        <InlineField
          label="Уровень лояльности"
          value={client.loyaltyLevel ?? ""}
          editing={activeField === "loyaltyLevel"}
          canEdit={editable}
          onStartEdit={() => startEdit("loyaltyLevel", client.loyaltyLevel ?? "")}
          onCancel={cancelEdit}
          onSave={() => void saveField("loyaltyLevel")}
          saving={saving}
          error={activeField === "loyaltyLevel" ? error : null}
        >
          <input
            className={fieldClass}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </InlineField>

        <InlineField
          label="Статус"
          value={client.status}
          displayValue={getClientStatusLabel(client.status)}
          editing={activeField === "status"}
          canEdit={editable}
          onStartEdit={() => startEdit("status", client.status)}
          onCancel={cancelEdit}
          onSave={() => void saveField("status")}
          saving={saving}
          error={activeField === "status" ? error : null}
        >
          <select
            className={fieldClass}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          >
            {CLIENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {getClientStatusLabel(status)}
              </option>
            ))}
          </select>
        </InlineField>

        <div className="space-y-1">
          <p className="text-xs text-zinc-500">Бонусный баланс</p>
          <p className="text-sm text-zinc-900">{String(client.bonusBalance)}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-zinc-500">Общая сумма</p>
          <p className="text-sm text-zinc-900">{String(client.totalSpent)}</p>
        </div>
      </div>

      <div className="mt-4">
        <InlineField
          label="Заметки"
          value={client.notes ?? ""}
          editing={activeField === "notes"}
          canEdit={editable}
          onStartEdit={() => startEdit("notes", client.notes ?? "")}
          onCancel={cancelEdit}
          onSave={() => void saveField("notes")}
          saving={saving}
          error={activeField === "notes" ? error : null}
        >
          <textarea
            className={`${fieldClass} min-h-20`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </InlineField>
      </div>

      <section className="mt-6 rounded border border-zinc-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900">Теги</h2>
        {editable ? (
          <ClientTagsInlineEditor
            clientId={client.id}
            tags={client.tags}
            onTagsChange={(tags) => onClientChange({ tags })}
          />
        ) : client.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {client.tags.map((tag) => (
              <ClientTagBadge key={tag} tag={tag} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Теги не указаны.</p>
        )}
      </section>
    </>
  );
}
