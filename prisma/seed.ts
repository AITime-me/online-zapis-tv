import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const STUDIO_TIMEZONE = "Asia/Yekaterinburg";

function studioDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:00`;
  return new Date(iso);
}

function getStudioToday() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: STUDIO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")!.value);
  const month = Number(parts.find((part) => part.type === "month")!.value);
  const day = Number(parts.find((part) => part.type === "day")!.value);
  const date = new Date(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00+05:00`,
  );
  return { year, month, day, date };
}

async function upsertSynonym(
  serviceId: string,
  synonym: string,
  sortOrder: number,
  isActive = true,
) {
  await prisma.serviceSynonym.upsert({
    where: {
      serviceId_synonym: { serviceId, synonym },
    },
    update: { sortOrder, isActive },
    create: { serviceId, synonym, sortOrder, isActive },
  });
}

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const owner = await prisma.user.upsert({
    where: { email: "owner@example.local" },
    update: { passwordHash, isActive: true },
    create: {
      email: "owner@example.local",
      passwordHash,
      role: "OWNER",
      name: "Тестовый владелец",
    },
  });

  const manager = await prisma.user.upsert({
    where: { email: "manager@example.local" },
    update: { passwordHash, isActive: true },
    create: {
      email: "manager@example.local",
      passwordHash,
      role: "MANAGER",
      name: "Тестовый менеджер",
    },
  });

  const masterUser1 = await prisma.user.upsert({
    where: { email: "master@example.local" },
    update: { passwordHash, isActive: true },
    create: {
      email: "master@example.local",
      passwordHash,
      role: "MASTER",
      name: "Тестовый мастер",
    },
  });

  const masterUser2 = await prisma.user.upsert({
    where: { email: "master2@example.local" },
    update: { passwordHash, isActive: true },
    create: {
      email: "master2@example.local",
      passwordHash,
      role: "MASTER",
      name: "Тестовый мастер 2",
    },
  });

  const masterUser3 = await prisma.user.upsert({
    where: { email: "master3@example.local" },
    update: { passwordHash, isActive: true },
    create: {
      email: "master3@example.local",
      passwordHash,
      role: "MASTER",
      name: "Тестовый мастер 3",
    },
  });

  const master1 = await prisma.master.upsert({
    where: { userId: masterUser1.id },
    update: {
      internalName: "Анна И.",
      publicName: "Анна",
      clientDescription: "Стилист, стрижки и укладки (тест)",
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
    },
    create: {
      userId: masterUser1.id,
      internalName: "Анна И.",
      publicName: "Анна",
      clientDescription: "Стилист, стрижки и укладки (тест)",
      slotMinutes: 30,
      workStart: "09:00",
      workEnd: "18:00",
      breakAfterMinutes: 15,
      sortOrder: 1,
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
    },
  });

  const master2 = await prisma.master.upsert({
    where: { userId: masterUser2.id },
    update: {
      internalName: "Мария К.",
      publicName: "Мария",
      clientDescription: "Мастер маникюра и перманентного макияжа (тест)",
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
    },
    create: {
      userId: masterUser2.id,
      internalName: "Мария К.",
      publicName: "Мария",
      clientDescription: "Мастер маникюра и перманентного макияжа (тест)",
      slotMinutes: 15,
      workStart: "10:00",
      workEnd: "19:00",
      breakAfterMinutes: 10,
      sortOrder: 2,
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
    },
  });

  const master3 = await prisma.master.upsert({
    where: { userId: masterUser3.id },
    update: {
      internalName: "Елена С.",
      publicName: "Елена",
      clientDescription: "Lash-мастер (тест)",
      isActive: true,
      isPublic: false,
      isOnlineBookingEnabled: false,
    },
    create: {
      userId: masterUser3.id,
      internalName: "Елена С.",
      publicName: "Елена",
      clientDescription: "Lash-мастер (тест)",
      slotMinutes: 30,
      workStart: "11:00",
      workEnd: "20:00",
      breakAfterMinutes: 10,
      sortOrder: 3,
      isActive: true,
      isPublic: false,
      isOnlineBookingEnabled: false,
    },
  });

  const categoryHair = await prisma.serviceCategory.upsert({
    where: { id: "00000000-0000-4000-8000-000000000001" },
    update: {
      name: "Волосы",
      description: "Стрижки и уход за волосами (тест)",
      isActive: true,
      isPublic: true,
      sortOrder: 1,
    },
    create: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Волосы",
      description: "Стрижки и уход за волосами (тест)",
      sortOrder: 1,
      isActive: true,
      isPublic: true,
    },
  });

  const categoryNails = await prisma.serviceCategory.upsert({
    where: { id: "00000000-0000-4000-8000-000000000002" },
    update: {
      name: "Ногти",
      description: "Маникюр и педикюр (тест)",
      isActive: true,
      isPublic: true,
      sortOrder: 2,
    },
    create: {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Ногти",
      description: "Маникюр и педикюр (тест)",
      sortOrder: 2,
      isActive: true,
      isPublic: true,
    },
  });

  const categoryPmu = await prisma.serviceCategory.upsert({
    where: { id: "00000000-0000-4000-8000-000000000003" },
    update: {
      name: "Перманентный макияж",
      description: "PMU и коррекция (тест)",
      isActive: true,
      isPublic: true,
      sortOrder: 3,
    },
    create: {
      id: "00000000-0000-4000-8000-000000000003",
      name: "Перманентный макияж",
      description: "PMU и коррекция (тест)",
      sortOrder: 3,
      isActive: true,
      isPublic: true,
    },
  });

  const categoryRemoval = await prisma.serviceCategory.upsert({
    where: { id: "00000000-0000-4000-8000-000000000004" },
    update: {
      name: "Удаление",
      description: "Удаление перманента (тест)",
      isActive: true,
      isPublic: true,
      sortOrder: 4,
    },
    create: {
      id: "00000000-0000-4000-8000-000000000004",
      name: "Удаление",
      description: "Удаление перманента (тест)",
      sortOrder: 4,
      isActive: true,
      isPublic: true,
    },
  });

  const categoryLashes = await prisma.serviceCategory.upsert({
    where: { id: "00000000-0000-4000-8000-000000000005" },
    update: {
      name: "Ресницы",
      description: "Услуги для ресниц (тест)",
      isActive: true,
      isPublic: true,
      sortOrder: 5,
    },
    create: {
      id: "00000000-0000-4000-8000-000000000005",
      name: "Ресницы",
      description: "Услуги для ресниц (тест)",
      sortOrder: 5,
      isActive: true,
      isPublic: true,
    },
  });

  const serviceHaircut = await prisma.service.upsert({
    where: { id: "00000000-0000-4000-8000-000000000101" },
    update: {
      internalName: "Стрижка женская (тест)",
      publicName: "Стрижка",
      clientDescription: "Модельная стрижка (тест)",
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
    },
    create: {
      id: "00000000-0000-4000-8000-000000000101",
      categoryId: categoryHair.id,
      internalName: "Стрижка женская (тест)",
      publicName: "Стрижка",
      clientDescription: "Модельная стрижка (тест)",
      durationMinutes: 60,
      breakAfterMinutes: 15,
      price: 1500,
      sortOrder: 1,
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
    },
  });

  const serviceManicure = await prisma.service.upsert({
    where: { id: "00000000-0000-4000-8000-000000000102" },
    update: {
      internalName: "Маникюр классический (тест)",
      publicName: "Маникюр",
      clientDescription: "Классический маникюр (тест)",
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
    },
    create: {
      id: "00000000-0000-4000-8000-000000000102",
      categoryId: categoryNails.id,
      internalName: "Маникюр классический (тест)",
      publicName: "Маникюр",
      clientDescription: "Классический маникюр (тест)",
      durationMinutes: 90,
      breakAfterMinutes: 10,
      priceFrom: 1800,
      priceTo: 2500,
      sortOrder: 1,
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
    },
  });

  const servicePmu = await prisma.service.upsert({
    where: { id: "00000000-0000-4000-8000-000000000103" },
    update: {
      internalName: "Перманентный макияж (тест)",
      publicName: "Перманентный макияж",
      clientDescription: "PMU бровей или век (тест)",
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: false,
    },
    create: {
      id: "00000000-0000-4000-8000-000000000103",
      categoryId: categoryPmu.id,
      internalName: "Перманентный макияж (тест)",
      publicName: "Перманентный макияж",
      clientDescription: "PMU бровей или век (тест)",
      durationMinutes: 120,
      breakAfterMinutes: 15,
      priceFrom: 5000,
      priceTo: 8000,
      sortOrder: 1,
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: false,
    },
  });

  const servicePmuLips = await prisma.service.upsert({
    where: { id: "00000000-0000-4000-8000-000000000104" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000104",
      categoryId: categoryPmu.id,
      internalName: "Перманентный макияж губ (тест)",
      publicName: "Перманентный макияж губ",
      clientDescription: "PMU губ (тест)",
      durationMinutes: 150,
      breakAfterMinutes: 15,
      priceFrom: 6000,
      priceTo: 9000,
      sortOrder: 2,
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
    },
  });

  const serviceRemoval = await prisma.service.upsert({
    where: { id: "00000000-0000-4000-8000-000000000105" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000105",
      categoryId: categoryRemoval.id,
      internalName: "Удаление перманента (тест)",
      publicName: "Удаление перманента",
      clientDescription: "Лазерное/ремувер удаление (тест)",
      durationMinutes: 60,
      breakAfterMinutes: 10,
      priceFrom: 3000,
      priceTo: 5000,
      sortOrder: 1,
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
    },
  });

  const servicePlasma = await prisma.service.upsert({
    where: { id: "00000000-0000-4000-8000-000000000106" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000106",
      categoryId: categoryPmu.id,
      internalName: "Холодная плазма веки (тест)",
      publicName: "Холодная плазма веки",
      clientDescription: "Плазмолifting век (тест)",
      durationMinutes: 45,
      breakAfterMinutes: 10,
      price: 3500,
      sortOrder: 3,
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
    },
  });

  const serviceLashes = await prisma.service.upsert({
    where: { id: "00000000-0000-4000-8000-000000000107" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000107",
      categoryId: categoryLashes.id,
      internalName: "Ламинирование ресниц (тест)",
      publicName: "Ламинирование ресниц",
      clientDescription: "Уход и ламинирование (тест)",
      durationMinutes: 75,
      breakAfterMinutes: 10,
      price: 2200,
      sortOrder: 1,
      isActive: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
    },
  });

  const serviceArchived = await prisma.service.upsert({
    where: { id: "00000000-0000-4000-8000-000000000108" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000108",
      categoryId: categoryHair.id,
      internalName: "Устаревшая услуга (тест)",
      publicName: "Устаревшая услуга",
      clientDescription: "Снята с публикации, не удалена (тест)",
      durationMinutes: 30,
      breakAfterMinutes: 0,
      price: 500,
      sortOrder: 99,
      isActive: false,
      isPublic: false,
      isOnlineBookingEnabled: false,
    },
  });

  await upsertSynonym(serviceHaircut.id, "подстричься", 1);
  await upsertSynonym(serviceHaircut.id, "стрижка", 2);
  await upsertSynonym(serviceManicure.id, "маникюр", 1);
  await upsertSynonym(servicePmu.id, "татуаж", 1);
  await upsertSynonym(servicePmuLips.id, "пм губ", 1);
  await upsertSynonym(serviceRemoval.id, "убрать татуаж", 1);
  await upsertSynonym(servicePlasma.id, "плазма век", 1);
  await upsertSynonym(serviceLashes.id, "реснички", 1);
  await upsertSynonym(servicePmu.id, "перманент", 2, false);

  await prisma.masterService.upsert({
    where: {
      masterId_serviceId: { masterId: master1.id, serviceId: serviceHaircut.id },
    },
    update: {
      isEnabled: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
      sortOrder: 1,
    },
    create: {
      masterId: master1.id,
      serviceId: serviceHaircut.id,
      isEnabled: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
      sortOrder: 1,
    },
  });

  await prisma.masterService.upsert({
    where: {
      masterId_serviceId: { masterId: master2.id, serviceId: serviceManicure.id },
    },
    update: {
      isEnabled: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
      sortOrder: 1,
    },
    create: {
      masterId: master2.id,
      serviceId: serviceManicure.id,
      isEnabled: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
      sortOrder: 1,
    },
  });

  await prisma.masterService.upsert({
    where: {
      masterId_serviceId: { masterId: master2.id, serviceId: servicePmuLips.id },
    },
    update: {
      isEnabled: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
      durationMinutesOverride: 120,
      priceOverride: 7500,
      sortOrder: 2,
    },
    create: {
      masterId: master2.id,
      serviceId: servicePmuLips.id,
      isEnabled: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
      durationMinutesOverride: 120,
      priceOverride: 7500,
      sortOrder: 2,
    },
  });

  await prisma.masterService.upsert({
    where: {
      masterId_serviceId: { masterId: master2.id, serviceId: servicePmu.id },
    },
    update: {
      isEnabled: true,
      isPublic: true,
      isOnlineBookingEnabled: false,
      sortOrder: 3,
    },
    create: {
      masterId: master2.id,
      serviceId: servicePmu.id,
      isEnabled: true,
      isPublic: true,
      isOnlineBookingEnabled: false,
      sortOrder: 3,
    },
  });

  await prisma.masterService.upsert({
    where: {
      masterId_serviceId: { masterId: master2.id, serviceId: serviceRemoval.id },
    },
    update: {
      isEnabled: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
      sortOrder: 4,
    },
    create: {
      masterId: master2.id,
      serviceId: serviceRemoval.id,
      isEnabled: true,
      isPublic: true,
      isOnlineBookingEnabled: true,
      sortOrder: 4,
    },
  });

  await prisma.masterService.upsert({
    where: {
      masterId_serviceId: { masterId: master3.id, serviceId: serviceLashes.id },
    },
    update: {
      isEnabled: true,
      isPublic: false,
      isOnlineBookingEnabled: false,
      sortOrder: 1,
    },
    create: {
      masterId: master3.id,
      serviceId: serviceLashes.id,
      isEnabled: true,
      isPublic: false,
      isOnlineBookingEnabled: false,
      sortOrder: 1,
    },
  });

  const today = getStudioToday();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  await prisma.appointment.upsert({
    where: { id: "00000000-0000-4000-8000-000000000211" },
    update: {
      standardDurationMinutes: serviceHaircut.durationMinutes,
      standardBreakAfterMinutes: serviceHaircut.breakAfterMinutes,
      serviceDurationMinutes: serviceHaircut.durationMinutes,
      breakAfterMinutes: serviceHaircut.breakAfterMinutes,
      isManualTimeOverride: false,
    },
    create: {
      id: "00000000-0000-4000-8000-000000000211",
      masterId: master1.id,
      serviceId: serviceHaircut.id,
      startsAt: studioDate(today.year, today.month, today.day, 11, 0),
      endsAt: studioDate(today.year, today.month, today.day, 12, 0),
      clientName: "Тестовая Марина",
      clientPhone: "+70000000001",
      comment: "Тестовая запись на сегодня",
      importantNote: "VIP (тест)",
      isBold: true,
      standardDurationMinutes: serviceHaircut.durationMinutes,
      standardBreakAfterMinutes: serviceHaircut.breakAfterMinutes,
      serviceDurationMinutes: serviceHaircut.durationMinutes,
      breakAfterMinutes: serviceHaircut.breakAfterMinutes,
      isManualTimeOverride: false,
      status: "SCHEDULED",
      source: "INTERNAL",
      createdByUserId: manager.id,
    },
  });

  await prisma.appointment.upsert({
    where: { id: "00000000-0000-4000-8000-000000000212" },
    update: {
      standardDurationMinutes: serviceManicure.durationMinutes,
      standardBreakAfterMinutes: serviceManicure.breakAfterMinutes,
      serviceDurationMinutes: serviceManicure.durationMinutes,
      breakAfterMinutes: serviceManicure.breakAfterMinutes,
      isManualTimeOverride: false,
    },
    create: {
      id: "00000000-0000-4000-8000-000000000212",
      masterId: master2.id,
      serviceId: serviceManicure.id,
      startsAt: studioDate(today.year, today.month, today.day, 15, 30),
      endsAt: studioDate(today.year, today.month, today.day, 17, 0),
      clientName: "Тестовая Ольга",
      clientPhone: "+70000000002",
      comment: "Вторая тестовая запись на сегодня",
      standardDurationMinutes: serviceManicure.durationMinutes,
      standardBreakAfterMinutes: serviceManicure.breakAfterMinutes,
      serviceDurationMinutes: serviceManicure.durationMinutes,
      breakAfterMinutes: serviceManicure.breakAfterMinutes,
      isManualTimeOverride: false,
      status: "CONFIRMED",
      source: "ONLINE",
      createdByUserId: manager.id,
    },
  });

  await prisma.appointment.upsert({
    where: { id: "00000000-0000-4000-8000-000000000213" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000213",
      masterId: master2.id,
      serviceId: servicePmuLips.id,
      startsAt: studioDate(today.year, today.month, today.day, 10, 0),
      endsAt: studioDate(today.year, today.month, today.day, 11, 30),
      clientName: "Тестовая Ольга",
      clientPhone: "+70000000003",
      comment: "Ручное переопределение времени (тест)",
      importantNote: "VIP",
      isBold: true,
      standardDurationMinutes: 120,
      standardBreakAfterMinutes: 15,
      serviceDurationMinutes: 90,
      breakAfterMinutes: 0,
      isManualTimeOverride: true,
      status: "SCHEDULED",
      source: "INTERNAL",
      createdByUserId: manager.id,
    },
  });

  await prisma.extraWorkWindow.upsert({
    where: { id: "00000000-0000-4000-8000-000000000501" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000501",
      masterId: master2.id,
      workDate: today.date,
      startsAt: studioDate(today.year, today.month, today.day, 8, 0),
      endsAt: studioDate(today.year, today.month, today.day, 10, 0),
      isOnlineBookingEnabled: true,
      createdByUserId: manager.id,
    },
  });

  await prisma.scheduleBlock.upsert({
    where: { id: "00000000-0000-4000-8000-000000000311" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000311",
      masterId: master1.id,
      startsAt: studioDate(today.year, today.month, today.day, 13, 0),
      endsAt: studioDate(today.year, today.month, today.day, 14, 0),
      blockType: "BREAK",
      internalReason: "Обед (тест, сегодня)",
      createdByUserId: manager.id,
    },
  });

  await prisma.managerNote.upsert({
    where: { id: "00000000-0000-4000-8000-000000000411" },
    update: { noteDate: today.date, content: "Заметка менеджера на сегодня (тест)" },
    create: {
      id: "00000000-0000-4000-8000-000000000411",
      noteDate: today.date,
      content: "Заметка менеджера на сегодня (тест)",
      createdByUserId: manager.id,
    },
  });

  const appointmentStart = studioDate(
    tomorrow.getFullYear(),
    tomorrow.getMonth() + 1,
    tomorrow.getDate(),
    10,
    0,
  );

  const appointmentEnd = studioDate(
    tomorrow.getFullYear(),
    tomorrow.getMonth() + 1,
    tomorrow.getDate(),
    11,
    30,
  );

  await prisma.appointment.upsert({
    where: { id: "00000000-0000-4000-8000-000000000201" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000201",
      masterId: master1.id,
      serviceId: serviceHaircut.id,
      startsAt: appointmentStart,
      endsAt: appointmentEnd,
      clientName: "Тестовый клиент 1",
      clientPhone: "+79000000001",
      comment: "Тестовый комментарий",
      importantNote: "Важная пометка (тест)",
      isBold: true,
      status: "SCHEDULED",
      source: "INTERNAL",
      createdByUserId: manager.id,
    },
  });

  await prisma.scheduleBlock.upsert({
    where: { id: "00000000-0000-4000-8000-000000000301" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000301",
      masterId: master1.id,
      startsAt: studioDate(
        tomorrow.getFullYear(),
        tomorrow.getMonth() + 1,
        tomorrow.getDate(),
        14,
        0,
      ),
      endsAt: studioDate(
        tomorrow.getFullYear(),
        tomorrow.getMonth() + 1,
        tomorrow.getDate(),
        15,
        0,
      ),
      blockType: "BREAK",
      internalReason: "Перерыв (тест)",
      createdByUserId: manager.id,
    },
  });

  await prisma.managerNote.upsert({
    where: { id: "00000000-0000-4000-8000-000000000401" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000401",
      noteDate: tomorrow,
      content: "Заметка менеджера (тест)",
      createdByUserId: manager.id,
    },
  });

  const monthDay5 = new Date(`${today.year}-${String(today.month).padStart(2, "0")}-05T12:00:00+05:00`);
  const monthDay10 = new Date(`${today.year}-${String(today.month).padStart(2, "0")}-10T12:00:00+05:00`);
  const monthDay15 = new Date(`${today.year}-${String(today.month).padStart(2, "0")}-15T12:00:00+05:00`);

  if (today.day !== 5) {
    await prisma.appointment.upsert({
      where: { id: "00000000-0000-4000-8000-000000000221" },
      update: {},
      create: {
        id: "00000000-0000-4000-8000-000000000221",
        masterId: master1.id,
        serviceId: serviceHaircut.id,
        startsAt: studioDate(today.year, today.month, 5, 14, 0),
        endsAt: studioDate(today.year, today.month, 5, 15, 0),
        clientName: "Тестовая Марина",
        clientPhone: "+70000000004",
        comment: "Запись на 5-е число месяца (тест)",
        standardDurationMinutes: serviceHaircut.durationMinutes,
        standardBreakAfterMinutes: serviceHaircut.breakAfterMinutes,
        serviceDurationMinutes: serviceHaircut.durationMinutes,
        breakAfterMinutes: serviceHaircut.breakAfterMinutes,
        isManualTimeOverride: false,
        status: "SCHEDULED",
        source: "PHONE",
        createdByUserId: manager.id,
      },
    });
  }

  if (today.day !== 10) {
    await prisma.appointment.upsert({
      where: { id: "00000000-0000-4000-8000-000000000222" },
      update: {},
      create: {
        id: "00000000-0000-4000-8000-000000000222",
        masterId: master2.id,
        serviceId: servicePmuLips.id,
        startsAt: studioDate(today.year, today.month, 10, 12, 0),
        endsAt: studioDate(today.year, today.month, 10, 14, 0),
        clientName: "Тестовая Ольга",
        clientPhone: "+70000000005",
        comment: "Курсовая процедура, 10-е число (тест)",
        standardDurationMinutes: 120,
        standardBreakAfterMinutes: 15,
        serviceDurationMinutes: 120,
        breakAfterMinutes: 15,
        isManualTimeOverride: false,
        status: "CONFIRMED",
        source: "INTERNAL",
        createdByUserId: manager.id,
      },
    });

    await prisma.managerNote.upsert({
      where: { id: "00000000-0000-4000-8000-000000000412" },
      update: {},
      create: {
        id: "00000000-0000-4000-8000-000000000412",
        noteDate: monthDay10,
        content: "Перезвонить клиенту 10-го (тест)",
        createdByUserId: manager.id,
      },
    });
  }

  if (today.day !== 15) {
    await prisma.scheduleBlock.upsert({
      where: { id: "00000000-0000-4000-8000-000000000312" },
      update: {},
      create: {
        id: "00000000-0000-4000-8000-000000000312",
        masterId: master2.id,
        startsAt: studioDate(today.year, today.month, 15, 14, 0),
        endsAt: studioDate(today.year, today.month, 15, 15, 0),
        blockType: "BREAK",
        internalReason: "Перерыв 15-го (тест)",
        createdByUserId: manager.id,
      },
    });

    await prisma.managerNote.upsert({
      where: { id: "00000000-0000-4000-8000-000000000413" },
      update: {},
      create: {
        id: "00000000-0000-4000-8000-000000000413",
        noteDate: monthDay15,
        content: "Проверить запись на 15-е (тест)",
        createdByUserId: manager.id,
      },
    });
  }

  if (today.day !== 5) {
    await prisma.managerNote.upsert({
      where: { id: "00000000-0000-4000-8000-000000000414" },
      update: {},
      create: {
        id: "00000000-0000-4000-8000-000000000414",
        noteDate: monthDay5,
        content: "Смена менеджера 5-го (тест)",
        createdByUserId: manager.id,
      },
    });
  }

  await prisma.bookingLink.upsert({
    where: { token: "test-bot-token-demo" },
    update: {
      serviceId: serviceManicure.id,
      masterId: master2.id,
    },
    create: {
      token: "test-bot-token-demo",
      serviceId: serviceManicure.id,
      masterId: master2.id,
      source: "bot",
      promoCode: "TEST10",
      botSessionId: "bot-session-test-001",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  console.log("Seed completed.");
  console.log(`Timezone: ${STUDIO_TIMEZONE}`);
  console.log(`Users: owner=${owner.email}, manager=${manager.email}`);
  console.log(`Masters: ${master1.publicName}, ${master2.publicName}, ${master3.publicName}`);
  console.log(
    `Services: ${serviceHaircut.publicName}, ${serviceManicure.publicName}, ${servicePmu.publicName}, ${serviceArchived.internalName} (archived)`,
  );
  console.log("Booking link token: test-bot-token-demo");

  await prisma.gameConfig.upsert({
    where: { id: "default" },
    update: {
      isActive: true,
      ctaButtonLink: "/promo/procedure-gift",
    },
    create: {
      id: "default",
      isActive: true,
      title: "Поймай своё время",
      description:
        "Пройдите короткую игру — мы подберём направление ухода, подарок и готовый текст для отправки администратору.",
      resultHeaderText: "Ваш результат готов ✨",
      directionLabelText: "Ваше направление ухода:",
      giftLabelText: "Ваш подарок:",
      ctaButtonText: "Узнать свой подарок",
      ctaButtonLink: "/promo/procedure-gift",
      managerMessageHeader:
        "Здравствуйте!\n\nЯ прошла игру «Поймай своё время».\n\nМой результат:\n",
      managerMessageFooter:
        "Хочу узнать условия получения подарка и записаться.",
    },
  });

  const seedGifts = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Уход для рук",
      shortDescription:
        "Мягкий уход для кожи рук, который помогает вернуть ощущение ухоженности, мягкости и внимания к себе.",
      probability: 50,
      priority: "main",
      cardStyle: "default",
      requiredPremiumLevel: 0,
      allowedGameDirections: [],
      allowedResultTypes: [],
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Холодная плазма губ",
      shortDescription:
        "Деликатная процедура ухода за губами, направленная на улучшение качества кожи, увлажнённость и более гладкий рельеф.",
      probability: 25,
      priority: "standard",
      cardStyle: "accent",
      requiredPremiumLevel: 0,
      allowedGameDirections: ["faceCare", "faceMassage"],
      allowedResultTypes: [],
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Лазерная биоревитализация",
      shortDescription:
        "Процедура для глубокого увлажнения и поддержки качества кожи.",
      probability: 18,
      priority: "rare",
      cardStyle: "accent",
      requiredPremiumLevel: 0,
      allowedGameDirections: ["faceCare", "recovery", "toneCare"],
      allowedResultTypes: [],
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Формула сияния",
      shortDescription:
        "Комплексный уход для кожи, который помогает вернуть ощущение ухоженности, увлажнённости и более ровного внешнего вида кожи.",
      probability: 7,
      priority: "premium",
      cardStyle: "premium",
      requiredPremiumLevel: 2,
      allowedGameDirections: ["toneCare", "recovery"],
      allowedResultTypes: [],
    },
  ] as const;

  for (const gift of seedGifts) {
    await prisma.gameGift.upsert({
      where: { id: gift.id },
      update: {
        name: gift.name,
        shortDescription: gift.shortDescription,
        probability: gift.probability,
        priority: gift.priority,
        cardStyle: gift.cardStyle,
        requiredPremiumLevel: gift.requiredPremiumLevel,
        allowedGameDirections: [...gift.allowedGameDirections],
        allowedResultTypes: [...gift.allowedResultTypes],
        isActive: true,
      },
      create: {
        id: gift.id,
        name: gift.name,
        shortDescription: gift.shortDescription,
        probability: gift.probability,
        priority: gift.priority,
        cardStyle: gift.cardStyle,
        requiredPremiumLevel: gift.requiredPremiumLevel,
        allowedGameDirections: [...gift.allowedGameDirections],
        allowedResultTypes: [...gift.allowedResultTypes],
        isActive: true,
      },
    });
  }

  const seedPromotions = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "Подарок после игры «Поймай своё время»",
      slug: "podarok-posle-igry-poimay-svoe-vremya",
      shortDescription:
        "Персональный подарок и рекомендация после прохождения игры.",
      description:
        "После прохождения игры клиент получает персональную рекомендацию и подарок к записи.",
      type: "GAME" as const,
      status: "ACTIVE" as const,
      isActive: true,
      giftTitle: "Персональный подарок к записи",
      giftDescription:
        "После прохождения игры клиент получает персональную рекомендацию и подарок к записи.",
      source: "GAME" as const,
      ctaText: "Получить подарок",
      ctaLink: "/promo/procedure-gift",
      priority: 10,
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      title: "Летнее сияние кожи",
      slug: "letnee-siyanie-kozhi",
      shortDescription: "Сезонное предложение для ухоженной кожи.",
      description:
        "Сезонное предложение для тех, кто хочет поддержать ухоженный вид кожи.",
      type: "SEASONAL" as const,
      status: "DRAFT" as const,
      isActive: false,
      giftTitle: "Бонус к уходовой процедуре",
      giftDescription:
        "Сезонное предложение для тех, кто хочет поддержать ухоженный вид кожи.",
      source: "SEASONAL" as const,
      priority: 50,
    },
    {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      title: "Подбор процедуры с мастером",
      slug: "podbor-procedury-s-masterom",
      shortDescription: "Индивидуальная рекомендация по уходу.",
      description:
        "Клиент может оставить заявку, а студия подберёт подходящее направление ухода.",
      type: "CONSULTATION" as const,
      status: "ACTIVE" as const,
      isActive: true,
      giftTitle: "Индивидуальная рекомендация",
      giftDescription:
        "Клиент может оставить заявку, а студия подберёт подходящее направление ухода.",
      source: "MANUAL" as const,
      priority: 20,
    },
    {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      title: "Скидка -30% на холодную плазму",
      slug: "skidka-30-holodnaya-plazma",
      shortDescription: "Скидка на первую процедуру холодной плазмы.",
      description:
        "Скидка 30% действует на первую процедуру холодной плазмы.",
      type: "DISCOUNT" as const,
      status: "DRAFT" as const,
      isActive: false,
      discountValue: 30,
      discountUnit: "PERCENT" as const,
      discountDescription:
        "Скидка на первую процедуру холодной плазмы.",
      conditions:
        "Действует для первой записи на процедуру холодной плазмы.",
      source: "MANUAL" as const,
      priority: 40,
    },
  ] as const;

  for (const promotion of seedPromotions) {
    const discountFields = {
      discountValue:
        "discountValue" in promotion ? promotion.discountValue : null,
      discountUnit: "discountUnit" in promotion ? promotion.discountUnit : null,
      discountDescription:
        "discountDescription" in promotion ? promotion.discountDescription : null,
    };

    await prisma.promotion.upsert({
      where: { id: promotion.id },
      update: {
        title: promotion.title,
        slug: promotion.slug,
        shortDescription: promotion.shortDescription,
        description: promotion.description,
        type: promotion.type,
        status: promotion.status,
        isActive: promotion.isActive,
        giftTitle: "giftTitle" in promotion ? promotion.giftTitle : null,
        giftDescription:
          "giftDescription" in promotion ? promotion.giftDescription : null,
        source: promotion.source,
        ctaText: "ctaText" in promotion ? promotion.ctaText : null,
        ctaLink: "ctaLink" in promotion ? promotion.ctaLink : null,
        priority: promotion.priority,
        conditions: "conditions" in promotion ? promotion.conditions : null,
        ...discountFields,
      },
      create: {
        id: promotion.id,
        title: promotion.title,
        slug: promotion.slug,
        shortDescription: promotion.shortDescription,
        description: promotion.description,
        type: promotion.type,
        status: promotion.status,
        isActive: promotion.isActive,
        giftTitle: "giftTitle" in promotion ? promotion.giftTitle : null,
        giftDescription:
          "giftDescription" in promotion ? promotion.giftDescription : null,
        source: promotion.source,
        ctaText: "ctaText" in promotion ? promotion.ctaText : null,
        ctaLink: "ctaLink" in promotion ? promotion.ctaLink : null,
        priority: promotion.priority,
        conditions: "conditions" in promotion ? promotion.conditions : null,
        ...discountFields,
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
