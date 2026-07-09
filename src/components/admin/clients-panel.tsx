"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ClientStatus } from "@prisma/client";
import { readApiJsonResponse } from "@/lib/api/read-json-response";
import {
  CLIENT_STATUSES,
  getClientStatusLabel,
} from "@/lib/clients/defaults";
import { clientMatchesTagSearch } from "@/lib/clients/tags";
import { ClientTagsEditor } from "@/components/admin/client-tags-editor";
import { ClientTagBadge } from "@/components/admin/client-tag-badges";
import { ClientTagsInlineEditor } from "@/components/admin/client-tags-inline-editor";
import { ClientsImportModal } from "@/components/admin/clients-import-modal";
import type { ClientAdminDto } from "@/types/client-admin";

type SaveStatus = "idle" | "saving" | "saved" | "error";
type ArchiveFilter = "all" | "active" | "archived";
type StatusFilter = "all" | ClientStatus;

type ClientApiPayload = {
  ok: boolean;
  client?: ClientAdminDto;
  error?: string;
};

type ClientFormState = {
  fullName: string;
  phone: string;
  email: string;
  birthDate: string;
  gender: string;
  source: string;
  status: ClientStatus;
  tags: string[];
  notes: string;
  loyaltyLevel: string;
  bonusBalance: string;
  totalSpent: string;
  lastContactAt: string;
};

const fieldClass =
  "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";
const labelClass = "text-xs font-medium text-zinc-700";
const sectionClass = "space-y-4 rounded border border-zinc-200 bg-zinc-50 p-4";
const sectionTitleClass = "text-sm font-semibold text-zinc-900";

function emptyForm(): ClientFormState {
  return {
    fullName: "",
    phone: "",
    email: "",
    birthDate: "",
    gender: "",
    source: "",
    status: "NEW",
    tags: [],
    notes: "",
    loyaltyLevel: "",
    bonusBalance: "0",
    totalSpent: "0",
    lastContactAt: "",
  };
}

function formFromClient(client: ClientAdminDto): ClientFormState {
  return {
    fullName: client.fullName,
    phone: client.phone ?? "",
    email: client.email ?? "",
    birthDate: client.birthDate ?? "",
    gender: client.gender ?? "",
    source: client.source ?? "",
    status: client.status,
    tags: [...client.tags],
    notes: client.notes ?? "",
    loyaltyLevel: client.loyaltyLevel ?? "",
    bonusBalance: String(client.bonusBalance),
    totalSpent: String(client.totalSpent),
    lastContactAt: client.lastContactAt
      ? client.lastContactAt.slice(0, 16)
      : "",
  };
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function replaceClient(
  clients: ClientAdminDto[],
  updated: ClientAdminDto,
): ClientAdminDto[] {
  return clients.map((item) => (item.id === updated.id ? updated : item));
}

function buildPayload(form: ClientFormState) {
  return {
    fullName: form.fullName,
    phone: form.phone,
    email: form.email,
    birthDate: form.birthDate || null,
    gender: form.gender,
    source: form.source,
    status: form.status,
    tags: form.tags,
    notes: form.notes,
    loyaltyLevel: form.loyaltyLevel,
    bonusBalance: Number(form.bonusBalance || 0),
    totalSpent: Number(form.totalSpent || 0),
    lastContactAt: form.lastContactAt ? new Date(form.lastContactAt).toISOString() : null,
  };
}

async function requestClientMutation(
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): Promise<ClientAdminDto> {
  const response = await fetch("/api/admin/clients", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await readApiJsonResponse<ClientApiPayload>(response);
  if (!response.ok || !payload.ok || !payload.client) {
    throw new Error(payload.error ?? "Ошибка сохранения");
  }
  return payload.client;
}

export function ClientsPanel({
  initialClients,
  initialSearch = "",
}: {
  initialClients: ClientAdminDto[];
  initialSearch?: string;
}) {
  const [clients, setClients] = useState(initialClients);
  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("active");
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [editingClient, setEditingClient] = useState<ClientAdminDto | null>(null);
  const [form, setForm] = useState<ClientFormState>(emptyForm());
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setClients(initialClients);
  }, [initialClients]);

  useEffect(() => {
    if (initialSearch) {
      setSearch(initialSearch);
    }
  }, [initialSearch]);

  const filteredClients = useMemo(() => {
    const query = search.trim().toLowerCase();
    return clients.filter((client) => {
      if (archiveFilter === "active" && client.isArchived) return false;
      if (archiveFilter === "archived" && !client.isArchived) return false;
      if (statusFilter !== "all" && client.status !== statusFilter) return false;
      if (!query) return true;
      const haystack = [client.fullName, client.phone ?? "", client.email ?? ""]
        .join(" ")
        .toLowerCase();
      return (
        haystack.includes(query) || clientMatchesTagSearch(client.tags, query)
      );
    });
  }, [clients, search, statusFilter, archiveFilter]);

  const statusLabel =
    status === "saving"
      ? "Сохраняю..."
      : status === "saved"
        ? "Сохранено"
        : status === "error"
          ? `Ошибка${message ? `: ${message}` : ""}`
          : null;

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setArchiveFilter("active");
  };

  const openCreate = () => {
    setEditingClient(null);
    setForm(emptyForm());
    setMode("create");
    setMessage(null);
    setStatus("idle");
  };

  const openEdit = (client: ClientAdminDto) => {
    setEditingClient(client);
    setForm(formFromClient(client));
    setMode("edit");
    setMessage(null);
    setStatus("idle");
  };

  const closeForm = () => {
    setMode("list");
    setEditingClient(null);
    setForm(emptyForm());
    setMessage(null);
    setStatus("idle");
  };

  const saveClient = async () => {
    setStatus("saving");
    setMessage(null);

    try {
      const payload = buildPayload(form);
      if (mode === "create") {
        const client = await requestClientMutation("POST", payload);
        setClients((current) => [client, ...current]);
        if (client.hasActiveDuplicate) {
          setMessage(
            "В базе уже есть клиент с таким ФИО. Проверьте возможный дубль.",
          );
        }
        closeForm();
      } else if (mode === "edit" && editingClient) {
        const client = await requestClientMutation("PATCH", {
          id: editingClient.id,
          ...payload,
        });
        setClients((current) => replaceClient(current, client));
        setEditingClient(client);
        setForm(formFromClient(client));
      }
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка сохранения";
      setStatus("error");
      setMessage(text);
    }
  };

  const toggleArchive = async (client: ClientAdminDto) => {
    setStatus("saving");
    setMessage(null);

    try {
      const updatedClient = await requestClientMutation("PATCH", {
        id: client.id,
        ...(client.isArchived ? { restore: true } : { archive: true }),
      });
      setClients((current) => replaceClient(current, updatedClient));
      if (editingClient?.id === client.id) {
        setEditingClient(updatedClient);
        setForm(formFromClient(updatedClient));
      }
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "Ошибка изменения архива";
      setStatus("error");
      setMessage(text);
    }
  };

  const handleInlineTagsChange = (clientId: string, tags: string[]) => {
    setClients((current) =>
      current.map((client) =>
        client.id === clientId ? { ...client, tags } : client,
      ),
    );
    if (editingClient?.id === clientId) {
      setEditingClient((current) => (current ? { ...current, tags } : current));
      setForm((current) => ({ ...current, tags }));
    }
  };

  const refreshClients = async () => {
    setRefreshing(true);
    setExportError(null);
    try {
      const response = await fetch("/api/admin/clients", { cache: "no-store" });
      const payload = await readApiJsonResponse<{
        ok: boolean;
        clients?: ClientAdminDto[];
        error?: string;
      }>(response);
      if (!response.ok || !payload.ok || !payload.clients) {
        throw new Error(payload.error ?? "Не удалось обновить список клиентов");
      }
      setClients(payload.clients);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Не удалось обновить список клиентов",
      );
    } finally {
      setRefreshing(false);
    }
  };

  const exportClientsCsv = async () => {
    setExporting(true);
    setExportError(null);

    try {
      const params = new URLSearchParams();
      const query = search.trim();
      if (query) {
        params.set("q", query);
      }
      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      params.set("archived", archiveFilter);

      const response = await fetch(
        `/api/admin/clients/export?${params.toString()}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const payload = await readApiJsonResponse<{ error?: string }>(response);
          throw new Error(
            payload.error ?? "Не удалось выгрузить клиентов. Попробуйте ещё раз.",
          );
        }
        throw new Error("Не удалось выгрузить клиентов. Попробуйте ещё раз.");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? "tvoe-vremya-clients.csv";
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setExportError(
        error instanceof Error
          ? error.message
          : "Не удалось выгрузить клиентов. Попробуйте ещё раз.",
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-200 bg-white p-4">
        <p className="max-w-3xl text-sm text-zinc-600">
          База клиентов студии. Позже сюда можно будет привязать заявки, записи,
          переписки, подарки и уровни лояльности.
        </p>
        <div className="flex items-center gap-3">
          {statusLabel ? <span className="text-sm text-zinc-500">{statusLabel}</span> : null}
          {mode === "list" ? (
            <button
              type="button"
              onClick={openCreate}
              className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Добавить клиента
            </button>
          ) : (
            <button
              type="button"
              onClick={closeForm}
              className="rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100"
            >
              К списку
            </button>
          )}
        </div>
      </div>

      {mode === "list" ? (
        <>
          {exportError ? (
            <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {exportError}
            </div>
          ) : null}

          <section className="grid gap-3 rounded border border-zinc-200 bg-white p-4 md:grid-cols-[minmax(0,1.4fr)_12rem_12rem_auto] md:items-end">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Поиск</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Имя, телефон, email, тег"
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Статус</span>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
                className={fieldClass}
              >
                <option value="all">Все статусы</option>
                {CLIENT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {getClientStatusLabel(value)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Архив</span>
              <select
                value={archiveFilter}
                onChange={(event) =>
                  setArchiveFilter(event.target.value as ArchiveFilter)
                }
                className={fieldClass}
              >
                <option value="active">Активные</option>
                <option value="archived">В архиве</option>
                <option value="all">Все</option>
              </select>
            </label>
            <button
              type="button"
              onClick={resetFilters}
              className="rounded border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
            >
              Сбросить фильтры
            </button>
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshClients()}
              disabled={refreshing}
              className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
            >
              {refreshing ? "Обновление…" : "Обновить"}
            </button>
            <Link
              href="/admin/clients/duplicates"
              className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              Возможные дубли
            </Link>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              Импорт CSV
            </button>
            <button
              type="button"
              onClick={() => void exportClientsCsv()}
              disabled={exporting}
              className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
            >
              {exporting ? "Экспорт…" : "Экспорт CSV"}
            </button>
            <span className="text-xs text-zinc-500">
              Выгружаются клиенты с учётом текущих фильтров
            </span>
          </div>

          {filteredClients.length === 0 ? (
            <div className="rounded border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-sm text-zinc-600">
              {clients.length === 0
                ? "Клиентов пока нет. Добавьте первого клиента, чтобы начать вести базу."
                : "По выбранным фильтрам клиентов не найдено."}
            </div>
          ) : (
            <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Имя</th>
                    <th className="px-4 py-3 font-medium">Телефон</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Статус</th>
                    <th className="px-4 py-3 font-medium">Теги</th>
                    <th className="px-4 py-3 font-medium">Источник</th>
                    <th className="px-4 py-3 font-medium">Лояльность</th>
                    <th className="px-4 py-3 font-medium">Бонусы</th>
                    <th className="px-4 py-3 font-medium">Заявки</th>
                    <th className="px-4 py-3 font-medium">Последний контакт</th>
                    <th className="px-4 py-3 font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClients.map((client) => (
                    <tr
                      key={client.id}
                      className={`border-b border-zinc-100 last:border-0 ${
                        client.isArchived ? "opacity-70" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-zinc-900">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/admin/clients/${client.id}`}
                            className="text-[#1a73e8] hover:underline"
                          >
                            {client.fullName}
                          </Link>
                          {client.hasActiveDuplicate ? (
                            <Link
                              href={`/admin/clients/duplicates?q=${encodeURIComponent(client.phone ?? client.fullName)}`}
                              className="inline-flex rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                            >
                              Возможный дубль
                            </Link>
                          ) : null}
                          {client.mergedIntoClientId ? (
                            <Link
                              href={`/admin/clients/${client.mergedIntoClientId}`}
                              className="inline-flex rounded bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-900 hover:bg-violet-100"
                            >
                              Объединён
                            </Link>
                          ) : null}
                        </div>
                        {client.mergedIntoClientId && client.mergedIntoClientName ? (
                          <span className="mt-1 block text-xs text-zinc-500">
                            Объединён в{" "}
                            <Link
                              href={`/admin/clients/${client.mergedIntoClientId}`}
                              className="font-medium text-[#1a73e8] hover:underline"
                            >
                              {client.mergedIntoClientName}
                            </Link>
                          </span>
                        ) : null}
                        {client.isArchived ? (
                          <span className="mt-1 block text-xs text-zinc-500">
                            (архив)
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">{client.phone ?? "—"}</td>
                      <td className="px-4 py-3 text-zinc-700">{client.email ?? "—"}</td>
                      <td className="px-4 py-3">{getClientStatusLabel(client.status)}</td>
                      <td className="px-4 py-3">
                        {client.mergedIntoClientId ? (
                          <div className="flex flex-wrap gap-1">
                            {client.tags.map((tag) => (
                              <ClientTagBadge key={`${client.id}-${tag}`} tag={tag} compact />
                            ))}
                          </div>
                        ) : (
                          <ClientTagsInlineEditor
                            clientId={client.id}
                            tags={client.tags}
                            onTagsChange={(tags) =>
                              handleInlineTagsChange(client.id, tags)
                            }
                            compact
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-600">{client.source ?? "—"}</td>
                      <td className="px-4 py-3 text-zinc-600">
                        {client.loyaltyLevel ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-zinc-600">{client.bonusBalance}</td>
                      <td className="px-4 py-3 text-zinc-600">
                        <div>{client.bookingRequestCount}</div>
                        {client.lastBookingRequestAt ? (
                          <div className="text-xs text-zinc-500">
                            {formatDateTime(client.lastBookingRequestAt)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-zinc-600">
                        {formatDateTime(client.lastContactAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/admin/clients/${client.id}`}
                            className="font-medium text-[#1a73e8] hover:underline"
                          >
                            Открыть
                          </Link>
                          <button
                            type="button"
                            onClick={() => openEdit(client)}
                            className="font-medium text-[#1a73e8] hover:underline"
                          >
                            Редактировать
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleArchive(client)}
                            className="font-medium text-zinc-700 hover:underline"
                          >
                            {client.isArchived ? "Восстановить" : "Архивировать"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <section className={sectionClass}>
            <h3 className={sectionTitleClass}>Основное</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1 md:col-span-2">
                <span className={labelClass}>ФИО</span>
                <input
                  value={form.fullName}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, fullName: event.target.value }))
                  }
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Телефон</span>
                <input
                  value={form.phone}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, phone: event.target.value }))
                  }
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Email</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, email: event.target.value }))
                  }
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Дата рождения</span>
                <input
                  type="date"
                  value={form.birthDate}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, birthDate: event.target.value }))
                  }
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Источник</span>
                <input
                  value={form.source}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, source: event.target.value }))
                  }
                  placeholder="Онлайн-запись, игра, VK..."
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Статус</span>
                <select
                  value={form.status}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      status: event.target.value as ClientStatus,
                    }))
                  }
                  className={fieldClass}
                >
                  {CLIENT_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {getClientStatusLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className={sectionClass}>
            <h3 className={sectionTitleClass}>Теги</h3>
            <ClientTagsEditor
              tags={form.tags}
              onChange={(tags) => setForm((current) => ({ ...current, tags }))}
              disabled={status === "saving"}
            />
          </section>

          <section className={sectionClass}>
            <h3 className={sectionTitleClass}>CRM-заметки</h3>
            <div className="grid gap-4">
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Заметки</span>
                <textarea
                  value={form.notes}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  rows={4}
                  className={fieldClass}
                />
              </label>
            </div>
          </section>

          {mode === "edit" && editingClient ? (
            <section className={sectionClass}>
              <h3 className={sectionTitleClass}>Связанные заявки</h3>
              <div className="grid gap-2 text-sm text-zinc-700 md:grid-cols-2">
                <div>
                  <span className="text-zinc-500">Всего заявок:</span>{" "}
                  {editingClient.bookingRequestCount}
                </div>
                <div>
                  <span className="text-zinc-500">Последняя заявка:</span>{" "}
                  {formatDateTime(editingClient.lastBookingRequestAt)}
                </div>
              </div>
              <p className="text-xs text-zinc-500">
                Новые заявки из онлайн-записи и игры автоматически привязываются к
                клиенту по телефону или email.
              </p>
            </section>
          ) : null}

          <section className={sectionClass}>
            <h3 className={sectionTitleClass}>Лояльность</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Уровень лояльности</span>
                <input
                  value={form.loyaltyLevel}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      loyaltyLevel: event.target.value,
                    }))
                  }
                  placeholder="Например: базовый"
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Последний контакт</span>
                <input
                  type="datetime-local"
                  value={form.lastContactAt}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      lastContactAt: event.target.value,
                    }))
                  }
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Бонусный баланс</span>
                <input
                  type="number"
                  min={0}
                  value={form.bonusBalance}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      bonusBalance: event.target.value,
                    }))
                  }
                  className={fieldClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Сумма покупок</span>
                <input
                  type="number"
                  min={0}
                  value={form.totalSpent}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      totalSpent: event.target.value,
                    }))
                  }
                  className={fieldClass}
                />
              </label>
            </div>
            <p className="text-xs text-zinc-500">
              Поля лояльности пока только сохраняются. Расчёты и программа будут
              добавлены на следующих этапах CRM.
            </p>
          </section>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={saveClient}
              disabled={status === "saving"}
              className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
            >
              Сохранить
            </button>
          </div>
        </div>
      )}

      {importOpen ? (
        <ClientsImportModal
          onClose={() => setImportOpen(false)}
          onImported={(nextClients) => {
            setClients(nextClients);
          }}
        />
      ) : null}
    </div>
  );
}
