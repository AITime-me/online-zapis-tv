"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ServiceAdminRow,
  ServiceCategoryOption,
  ServiceMasterOption,
} from "@/types/service-admin";
import { ServiceForm } from "@/components/admin/service-form";
import { ServicesTable } from "@/components/admin/services-table";

type SaveStatus = "idle" | "saving" | "saved" | "error";

type StatusFilter = "all" | "active" | "archive";
type OnlineFilter = "all" | "enabled" | "disabled";

function replaceService(
  services: ServiceAdminRow[],
  updated: ServiceAdminRow,
): ServiceAdminRow[] {
  return services.map((item) => (item.id === updated.id ? updated : item));
}

function matchesProcedureSearch(service: ServiceAdminRow, query: string): boolean {
  const haystack = [
    service.publicName,
    service.internalName,
    service.clientDescription ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export function ServicesPanel({
  initialServices,
  initialFilterCategories,
  initialFilterMasters,
  initialFormCategories,
  initialFormMasters,
}: {
  initialServices: ServiceAdminRow[];
  initialFilterCategories: ServiceCategoryOption[];
  initialFilterMasters: ServiceMasterOption[];
  initialFormCategories: ServiceCategoryOption[];
  initialFormMasters: ServiceMasterOption[];
}) {
  const router = useRouter();
  const [services, setServices] = useState(initialServices);
  const [filterCategories, setFilterCategories] = useState(initialFilterCategories);
  const [filterMasters, setFilterMasters] = useState(initialFilterMasters);
  const [formCategories, setFormCategories] = useState(initialFormCategories);
  const [formMasters, setFormMasters] = useState(initialFormMasters);
  const [editingService, setEditingService] = useState<ServiceAdminRow | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [masterFilter, setMasterFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [onlineFilter, setOnlineFilter] = useState<OnlineFilter>("all");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    setServices(initialServices);
    setFilterCategories(initialFilterCategories);
    setFilterMasters(initialFilterMasters);
    setFormCategories(initialFormCategories);
    setFormMasters(initialFormMasters);
  }, [
    initialServices,
    initialFilterCategories,
    initialFilterMasters,
    initialFormCategories,
    initialFormMasters,
  ]);

  const filteredServices = useMemo(() => {
    const query = search.trim().toLowerCase();

    return services.filter((service) => {
      if (categoryFilter !== "all" && service.categoryId !== categoryFilter) {
        return false;
      }

      if (masterFilter !== "all") {
        const hasMaster = service.masters.some(
          (link) => link.masterId === masterFilter && link.isEnabled,
        );
        if (!hasMaster) {
          return false;
        }
      }

      if (statusFilter === "active" && !service.isActive) {
        return false;
      }
      if (statusFilter === "archive" && service.isActive) {
        return false;
      }

      if (onlineFilter === "enabled" && !service.isOnlineBookingEnabled) {
        return false;
      }
      if (onlineFilter === "disabled" && service.isOnlineBookingEnabled) {
        return false;
      }

      if (query && !matchesProcedureSearch(service, query)) {
        return false;
      }

      return true;
    });
  }, [
    services,
    search,
    categoryFilter,
    masterFilter,
    statusFilter,
    onlineFilter,
  ]);

  const refreshServices = useCallback(async () => {
    const response = await fetch("/api/services", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? "Не удалось обновить список");
    }
    setServices(payload.services);
    if (payload.filterCategories) {
      setFilterCategories(payload.filterCategories);
    }
    if (payload.filterMasters) {
      setFilterMasters(payload.filterMasters);
    }
    if (payload.formCategories) {
      setFormCategories(payload.formCategories);
    }
    if (payload.formMasters) {
      setFormMasters(payload.formMasters);
    }
    router.refresh();
  }, [router]);

  const handleSaveStatus = (status: SaveStatus, message?: string) => {
    setSaveStatus(status);
    setSaveMessage(message ?? null);
    if (status === "saved") {
      setTimeout(() => setSaveStatus("idle"), 2000);
    }
  };

  const openEditForm = (service: ServiceAdminRow) => {
    setEditingService(service);
  };

  const statusLabel =
    saveStatus === "saving"
      ? "Сохраняю..."
      : saveStatus === "saved"
        ? "Сохранено"
        : saveStatus === "error"
          ? `Ошибка${saveMessage ? `: ${saveMessage}` : ""}`
          : null;

  const selectClass =
    "rounded border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-800";

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border border-[#dadce0] bg-white px-4 py-3">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1 lg:col-span-2">
            <span className="text-xs font-medium text-zinc-700">
              Поиск по названию процедуры
            </span>
            <input
              type="search"
              placeholder="Например: плазма, брови, массаж..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-700">
              Категория / процедуры
            </span>
            <select
              className={selectClass}
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="all">Все</option>
              {filterCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-700">Мастер</span>
            <select
              className={selectClass}
              value={masterFilter}
              onChange={(event) => setMasterFilter(event.target.value)}
            >
              <option value="all">Все</option>
              {filterMasters.map((master) => (
                <option key={master.id} value={master.id}>
                  {master.internalName}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-700">Статус</span>
            <select
              className={selectClass}
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
            >
              <option value="active">Активные</option>
              <option value="archive">Архив</option>
              <option value="all">Все</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-700">Онлайн-запись</span>
            <select
              className={selectClass}
              value={onlineFilter}
              onChange={(event) =>
                setOnlineFilter(event.target.value as OnlineFilter)
              }
            >
              <option value="all">Все</option>
              <option value="enabled">Показываются</option>
              <option value="disabled">Не показываются</option>
            </select>
          </label>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-500">
            Показано {filteredServices.length} из {services.length} услуг
          </p>
          {statusLabel ? (
            <p
              className={`text-xs ${
                saveStatus === "error"
                  ? "text-red-600"
                  : saveStatus === "saved"
                    ? "text-green-700"
                    : "text-zinc-500"
              }`}
            >
              {statusLabel}
            </p>
          ) : null}
        </div>
      </div>

      {editingService ? (
        <ServiceForm
          service={editingService}
          categories={formCategories}
          masters={formMasters}
          onSaved={(updated) => {
            setServices((current) => replaceService(current, updated));
            setEditingService(updated);
            void refreshServices();
          }}
          onCancel={() => setEditingService(null)}
          onSaveStatus={handleSaveStatus}
        />
      ) : null}

      <ServicesTable services={filteredServices} onEdit={openEditForm} />
    </div>
  );
}
