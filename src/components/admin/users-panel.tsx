"use client";

import { useEffect, useMemo, useState } from "react";
import type { UserRole } from "@prisma/client";
import {
  ASSIGNABLE_USER_ROLES,
  getUserRoleLabel,
} from "@/lib/auth/role-catalog";
import type { UserAdminDto } from "@/types/user-admin";

type SaveStatus = "idle" | "saving" | "saved" | "error";
type StatusFilter = "all" | "active" | "inactive";
type RoleFilter = "all" | UserRole;

type UserFormState = {
  name: string;
  email: string;
  role: UserRole;
  phone: string;
  positionTitle: string;
  notes: string;
  temporaryPassword: string;
  isActive: boolean;
};

const fieldClass =
  "w-full rounded border border-zinc-300 px-2 py-1.5 text-sm text-zinc-900";
const labelClass = "text-xs font-medium text-zinc-700";
const sectionClass = "space-y-4 rounded border border-zinc-200 bg-zinc-50 p-4";

function emptyForm(role: UserRole = "MANAGER"): UserFormState {
  return {
    name: "",
    email: "",
    role,
    phone: "",
    positionTitle: "",
    notes: "",
    temporaryPassword: "",
    isActive: true,
  };
}

function formFromUser(user: UserAdminDto): UserFormState {
  return {
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone ?? "",
    positionTitle: user.positionTitle ?? "",
    notes: user.notes ?? "",
    temporaryPassword: "",
    isActive: user.isActive,
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

function replaceUser(users: UserAdminDto[], updated: UserAdminDto): UserAdminDto[] {
  return users.map((item) => (item.id === updated.id ? updated : item));
}

export function UsersPanel({ initialUsers }: { initialUsers: UserAdminDto[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [editingUser, setEditingUser] = useState<UserAdminDto | null>(null);
  const [form, setForm] = useState<UserFormState>(emptyForm());
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setUsers(initialUsers);
  }, [initialUsers]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== "all" && user.role !== roleFilter) {
        return false;
      }
      if (statusFilter === "active" && !user.isActive) {
        return false;
      }
      if (statusFilter === "inactive" && user.isActive) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [user.name, user.email, user.phone ?? "", user.positionTitle ?? ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [users, search, roleFilter, statusFilter]);

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
    setRoleFilter("all");
    setStatusFilter("all");
  };

  const openCreate = () => {
    setEditingUser(null);
    setForm(emptyForm());
    setMode("create");
    setMessage(null);
    setStatus("idle");
  };

  const openEdit = (user: UserAdminDto) => {
    setEditingUser(user);
    setForm(formFromUser(user));
    setMode("edit");
    setMessage(null);
    setStatus("idle");
  };

  const closeForm = () => {
    setMode("list");
    setEditingUser(null);
    setForm(emptyForm());
    setMessage(null);
    setStatus("idle");
  };

  const saveUser = async () => {
    setStatus("saving");
    setMessage(null);

    try {
      if (mode === "create") {
        const response = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            email: form.email,
            role: form.role,
            phone: form.phone,
            positionTitle: form.positionTitle,
            notes: form.notes,
            temporaryPassword: form.temporaryPassword,
          }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok || !payload.user) {
          throw new Error(payload.error ?? "Ошибка создания");
        }
        setUsers((current) => [...current, payload.user]);
        closeForm();
      } else if (mode === "edit" && editingUser) {
        const response = await fetch(`/api/admin/users/${editingUser.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            email: form.email,
            role: form.role,
            phone: form.phone,
            positionTitle: form.positionTitle,
            notes: form.notes,
            isActive: form.isActive,
            ...(form.temporaryPassword.trim()
              ? { temporaryPassword: form.temporaryPassword }
              : {}),
          }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok || !payload.user) {
          throw new Error(payload.error ?? "Ошибка сохранения");
        }
        setUsers((current) => replaceUser(current, payload.user));
        setEditingUser(payload.user);
        setForm((current) => ({ ...formFromUser(payload.user), temporaryPassword: "" }));
      }

      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка сохранения";
      setStatus("error");
      setMessage(text);
    }
  };

  const toggleActive = async (user: UserAdminDto) => {
    setStatus("saving");
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !payload.user) {
        throw new Error(payload.error ?? "Ошибка изменения статуса");
      }
      setUsers((current) => replaceUser(current, payload.user));
      if (editingUser?.id === user.id) {
        setEditingUser(payload.user);
        setForm(formFromUser(payload.user));
      }
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1500);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Ошибка изменения статуса";
      setStatus("error");
      setMessage(text);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-200 bg-white p-4">
        <p className="max-w-3xl text-sm text-zinc-600">
          Управляйте доступами сотрудников к сервису. Пользователи станут основой для
          будущей CRM: заявки, задачи, переписки, мессенджеры и лояльность.
        </p>
        <div className="flex items-center gap-3">
          {statusLabel ? <span className="text-sm text-zinc-500">{statusLabel}</span> : null}
          {mode === "list" ? (
            <button
              type="button"
              onClick={openCreate}
              className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Добавить пользователя
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
          <section className="grid gap-3 rounded border border-zinc-200 bg-white p-4 md:grid-cols-[minmax(0,1.4fr)_12rem_12rem_auto] md:items-end">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Поиск</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Имя, email, телефон"
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Роль</span>
              <select
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
                className={fieldClass}
              >
                <option value="all">Все роли</option>
                {ASSIGNABLE_USER_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {getUserRoleLabel(role)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Статус</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                className={fieldClass}
              >
                <option value="all">Все</option>
                <option value="active">Активные</option>
                <option value="inactive">Отключённые</option>
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

          {filteredUsers.length === 0 ? (
            <div className="rounded border border-dashed border-zinc-300 bg-white px-4 py-10 text-center text-sm text-zinc-600">
              {users.length === 0
                ? "Пользователей пока нет. Добавьте сотрудников, чтобы управлять доступами к сервису."
                : "По выбранным фильтрам пользователей не найдено."}
            </div>
          ) : (
            <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Имя</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Роль</th>
                    <th className="px-4 py-3 font-medium">Статус</th>
                    <th className="px-4 py-3 font-medium">Телефон</th>
                    <th className="px-4 py-3 font-medium">Должность</th>
                    <th className="px-4 py-3 font-medium">Создан</th>
                    <th className="px-4 py-3 font-medium">Последний вход</th>
                    <th className="px-4 py-3 font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="border-b border-zinc-100 last:border-0">
                      <td className="px-4 py-3 font-medium text-zinc-900">{user.name}</td>
                      <td className="px-4 py-3 text-zinc-700">{user.email}</td>
                      <td className="px-4 py-3">{getUserRoleLabel(user.role)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            user.isActive
                              ? "bg-emerald-50 text-emerald-800"
                              : "bg-zinc-100 text-zinc-600"
                          }`}
                        >
                          {user.isActive ? "Активен" : "Отключён"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-600">{user.phone ?? "—"}</td>
                      <td className="px-4 py-3 text-zinc-600">{user.positionTitle ?? "—"}</td>
                      <td className="px-4 py-3 text-zinc-600">
                        {formatDateTime(user.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-zinc-600">
                        {formatDateTime(user.lastLoginAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(user)}
                            className="font-medium text-[#1a73e8] hover:underline"
                          >
                            Редактировать
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleActive(user)}
                            disabled={user.isProtectedOwner && user.isActive}
                            className="font-medium text-zinc-700 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {user.isActive ? "Отключить" : "Включить"}
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
        <section className={sectionClass}>
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">
              {mode === "create" ? "Новый пользователь" : "Редактирование пользователя"}
            </h3>
            {editingUser?.isProtectedOwner ? (
              <p className="mt-1 text-xs text-amber-700">
                Нельзя отключить или понизить роль последнего владельца системы.
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Имя</span>
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Роль</span>
              <select
                value={form.role}
                disabled={editingUser?.isProtectedOwner}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    role: event.target.value as UserRole,
                  }))
                }
                className={fieldClass}
              >
                {ASSIGNABLE_USER_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {getUserRoleLabel(role)}
                  </option>
                ))}
              </select>
            </label>
            {mode === "edit" ? (
              <label className="flex items-center gap-2 self-end text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  disabled={editingUser?.isProtectedOwner}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, isActive: event.target.checked }))
                  }
                  className="mt-0.5"
                />
                <span>Активен</span>
              </label>
            ) : null}
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Телефон</span>
              <input
                value={form.phone}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Должность</span>
              <input
                value={form.positionTitle}
                onChange={(event) =>
                  setForm((current) => ({ ...current, positionTitle: event.target.value }))
                }
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className={labelClass}>
                {mode === "create" ? "Временный пароль" : "Новый временный пароль"}
              </span>
              <input
                type="password"
                value={form.temporaryPassword}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    temporaryPassword: event.target.value,
                  }))
                }
                placeholder={mode === "edit" ? "Оставьте пустым, если менять не нужно" : ""}
                className={fieldClass}
              />
              <span className="text-xs leading-relaxed text-zinc-500">
                Передайте временный пароль сотруднику безопасным способом. После входа
                пароль можно будет заменить, если такая функция будет добавлена.
              </span>
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className={labelClass}>Заметки</span>
              <textarea
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                rows={4}
                className={fieldClass}
              />
            </label>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={saveUser}
              disabled={status === "saving"}
              className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
            >
              Сохранить
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
