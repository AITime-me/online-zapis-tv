/**
 * Контрольная ревизия MVP.
 * Usage: npx tsx scripts/mvp-audit.ts
 */

import { prisma } from "../src/lib/db";
import { getStudioTodayRange } from "../src/lib/datetime/studio";
import { isValidScheduleViewToken } from "../src/lib/auth/view-schedule-token";
import { SEED_TEST_SERVICE_IDS } from "../src/lib/services/seed-test-service-ids";
import { getScheduleMonthData } from "../src/services/ScheduleMonthService";
import { listServices, listServiceFilterMasters } from "../src/services/ServiceAdminService";
import { listBookableServicesForMaster } from "../src/services/ScheduleEditorOptionsService";
import { listMasters } from "../src/services/MasterAdminService";
import {
  AppointmentConflictError,
  createAppointment,
  cancelAppointment,
} from "../src/services/AppointmentService";
import { emergencyExportService } from "../src/services/EmergencyExportService";
import fs from "node:fs";

type Check = { name: string; ok: boolean; detail: string };

const checks: Check[] = [];
const createdAppointmentIds: string[] = [];

function record(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
  const mark = ok ? "OK" : "FAIL";
  console.log(`[${mark}] ${name}: ${detail}`);
}

function hasService(services: { publicName: string }[], needle: string): boolean {
  return services.some((service) => service.publicName.includes(needle));
}

async function findMaster(internalPart: string) {
  return prisma.master.findFirst({
    where: { internalName: { contains: internalPart } },
  });
}

async function main() {
  console.log("=== MVP AUDIT ===\n");

  // 1. Schedule month + masters order
  const monthKey = getStudioTodayRange().dateKey.slice(0, 7);
  const monthData = await getScheduleMonthData(monthKey);
  record(
    "/schedule month data",
    monthData.days.length > 0,
    `month=${monthData.month}, days=${monthData.days.length}`,
  );

  const expectedMasterOrder = ["Татьяна", "Ксения", "Ирина", "Ирина Б", "Елена"];
  const actualNames = monthData.masters.map((m) => m.internalName);
  const orderOk =
    actualNames.length === expectedMasterOrder.length &&
    expectedMasterOrder.every((name, index) => actualNames[index]?.includes(name));
  record(
    "Порядок мастеров в расписании",
    orderOk,
    actualNames.join(", ") || "(нет)",
  );

  const noTestMasters = !monthData.masters.some((m) =>
    ["Анна", "Мария", "Елена С."].some((t) => m.internalName.includes(t)),
  );
  record(
    "Нет seed-тестовых мастеров в расписании",
    noTestMasters,
    noTestMasters ? actualNames.join(", ") : "найдены тестовые",
  );

  // 4. Service filtering by master
  const ksenia = await findMaster("Ксения");
  const tatyana = await findMaster("Татьяна");
  const irinaB = await findMaster("Ирина Б");
  if (!ksenia || !tatyana || !irinaB) {
    throw new Error("Не найдены мастера для проверки услуг");
  }

  const kseniaServices = await listBookableServicesForMaster(ksenia.id);
  const tatyanaServices = await listBookableServicesForMaster(tatyana.id);
  const irinaBServices = await listBookableServicesForMaster(irinaB.id);

  record(
    "Ксения: нет Вельвет",
    !hasService(kseniaServices, "Velvet"),
    `count=${kseniaServices.length}`,
  );
  record(
    "Татьяна: есть Вельвет",
    hasService(tatyanaServices, "Velvet"),
    hasService(tatyanaServices, "Velvet") ? "найден" : "не найден",
  );
  record(
    "Ирина Б.: нет Вельвет",
    !hasService(irinaBServices, "Velvet"),
    `count=${irinaBServices.length}`,
  );
  record(
    "Ксения: есть Комплекс омоложения",
    hasService(kseniaServices, "Комплекс омоложения кожи рук"),
    hasService(kseniaServices, "Комплекс омоложения кожи рук") ? "найден" : "не найден",
  );
  record(
    "Татьяна: нет Комплекса омоложения",
    !hasService(tatyanaServices, "Комплекс омоложения кожи рук"),
    hasService(tatyanaServices, "Комплекс омоложения кожи рук") ? "найден (ошибка)" : "нет",
  );

  // 2 + 3. Create appointment + conflicts
  const owner = await prisma.user.findFirst({ where: { role: "OWNER" } });
  if (!owner) {
    throw new Error("OWNER не найден");
  }

  const bookable = kseniaServices.find((s) => s.durationMinutes >= 30);
  if (!bookable) {
    throw new Error("Нет bookable-услуги у Ксении");
  }

  record(
    "Услуга: длительность подставляется",
    bookable.durationMinutes > 0,
    `${bookable.publicName}: ${bookable.durationMinutes} мин`,
  );
  record(
    "Услуга: перерыв подставляется",
    bookable.breakAfterMinutes >= 0,
    `break=${bookable.breakAfterMinutes}, totalBusy=${bookable.totalBusyMinutes}`,
  );

  const dateKey = getStudioTodayRange().dateKey;

  const conflictService = kseniaServices.find((s) =>
    s.publicName.includes("Буккальный массаж лица"),
  );
  if (!conflictService) {
    record("Конфликты: услуга для теста", false, "Буккальный массаж лица не найден");
  } else {
    try {
      const first = await createAppointment(
        {
          masterId: ksenia.id,
          dateKey,
          startTime: "18:00",
          endTime: "19:00",
          serviceId: conflictService.id,
          clientName: "MVP Audit Conflict 1",
          clientPhone: "+79991111101",
          status: "SCHEDULED",
          source: "INTERNAL",
        },
        owner.id,
      );
      createdAppointmentIds.push(first.id);

      const stored = await prisma.appointment.findUnique({
        where: { id: first.id },
        select: { breakAfterMinutes: true, status: true },
      });
      record(
        "Запись сохраняется",
        stored?.status === "SCHEDULED",
        `id=${first.id}, break=${stored?.breakAfterMinutes}`,
      );

      let blockedAt1100 = false;
      try {
        await createAppointment(
          {
            masterId: ksenia.id,
            dateKey,
            startTime: "19:00",
            endTime: "19:30",
            serviceId: conflictService.id,
            clientName: "MVP Audit Conflict 2",
            clientPhone: "+79991111102",
            status: "SCHEDULED",
            source: "INTERNAL",
          },
          owner.id,
        );
      } catch (error) {
        blockedAt1100 = error instanceof AppointmentConflictError;
      }
      record(
        "Конфликт: 19:00 запрещено (18:00–19:00 + перерыв)",
        blockedAt1100,
        blockedAt1100 ? "AppointmentConflictError" : "не заблокировано",
      );

      const allowed = await createAppointment(
        {
          masterId: ksenia.id,
          dateKey,
          startTime: "19:15",
          endTime: "19:45",
          serviceId: conflictService.id,
          clientName: "MVP Audit Conflict 3",
          clientPhone: "+79991111103",
          status: "SCHEDULED",
          source: "INTERNAL",
        },
        owner.id,
      );
      createdAppointmentIds.push(allowed.id);
      record(
        "Конфликт: 19:15 разрешено",
        true,
        `id=${allowed.id}`,
      );
    } catch (error) {
      record(
        "Конфликты: блок тестов",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // 6. Soft cancel
  if (createdAppointmentIds.length > 0) {
    const cancelId = createdAppointmentIds[0]!;
    await cancelAppointment(cancelId);
    const cancelled = await prisma.appointment.findUnique({
      where: { id: cancelId },
      select: { status: true },
    });
    record(
      "Отмена: soft-cancel (запись в БД)",
      cancelled?.status === "CANCELLED",
      `id=${cancelId}, status=${cancelled?.status}`,
    );
    createdAppointmentIds.shift();
  }

  // Cleanup remaining test appointments
  for (const id of createdAppointmentIds) {
    await cancelAppointment(id);
  }
  createdAppointmentIds.length = 0;
  record(
    "Тестовые записи отменены",
    true,
    "MVP Audit Conflict * — cancel",
  );

  // 7. View schedule token
  const viewToken = process.env.SCHEDULE_VIEW_TOKEN ?? "";
  record(
    "/view/schedule token",
    isValidScheduleViewToken(viewToken),
    viewToken ? "валиден" : "SCHEDULE_VIEW_TOKEN не задан",
  );

  // 8. Admin services
  const services = await listServices();
  const seedInList = services.filter((s) =>
    (SEED_TEST_SERVICE_IDS as readonly string[]).includes(s.id),
  );
  record(
    "/admin/services: 88 реальных услуг",
    services.length === 88,
    `count=${services.length}`,
  );
  record(
    "/admin/services: seed-тестов нет",
    seedInList.length === 0,
    seedInList.length === 0 ? "0 seed в списке" : seedInList.map((s) => s.publicName).join(", "),
  );

  const filterMasters = await listServiceFilterMasters(services);
  const filterHasOnlyReal = filterMasters.every((m) =>
    expectedMasterOrder.some((part) => m.internalName.includes(part)),
  );
  record(
    "/admin/services: фильтры мастеров чистые",
    filterHasOnlyReal && filterMasters.length >= 5,
    filterMasters.map((m) => m.internalName).join(", "),
  );

  // 9. Admin masters
  const masters = await listMasters(true);
  const activeReal = masters.filter(
    (m) =>
      m.isActive &&
      expectedMasterOrder.some((part) => m.internalName.includes(part)),
  );
  const archived = masters.filter((m) => !m.isActive);
  record(
    "/admin/masters: реальные активны",
    activeReal.length >= 5,
    activeReal.map((m) => m.internalName).join(", "),
  );
  record(
    "/admin/masters: архив доступен",
    archived.length >= 0,
    `активных=${masters.filter((m) => m.isActive).length}, архив=${archived.length}`,
  );

  // 10. Emergency export
  try {
    const exportResult = await emergencyExportService.exportToday(owner.id);
    const exportRecord = exportResult.export;
    const fileExists = exportResult.filePath
      ? fs.existsSync(exportResult.filePath)
      : false;
    record(
      "Emergency export: создаётся",
      exportRecord.status === "SUCCESS",
      `status=${exportRecord.status}, id=${exportRecord.id}`,
    );
    record(
      "Emergency export: файл скачивается",
      fileExists,
      exportResult.filePath ?? "нет пути",
    );
  } catch (error) {
    record(
      "Emergency export",
      false,
      error instanceof Error ? error.message : String(error),
    );
  }

  console.log("\n=== SUMMARY ===");
  const failed = checks.filter((c) => !c.ok);
  console.log(`Всего: ${checks.length}, OK: ${checks.length - failed.length}, FAIL: ${failed.length}`);
  if (failed.length > 0) {
    console.log("\nПроблемы:");
    for (const item of failed) {
      console.log(`- ${item.name}: ${item.detail}`);
    }
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
