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
    update: {},
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
      status: "SCHEDULED",
      source: "INTERNAL",
      createdByUserId: manager.id,
    },
  });

  await prisma.appointment.upsert({
    where: { id: "00000000-0000-4000-8000-000000000212" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000212",
      masterId: master2.id,
      serviceId: serviceManicure.id,
      startsAt: studioDate(today.year, today.month, today.day, 15, 30),
      endsAt: studioDate(today.year, today.month, today.day, 17, 0),
      clientName: "Тестовая Ольга",
      clientPhone: "+70000000002",
      comment: "Вторая тестовая запись на сегодня",
      status: "CONFIRMED",
      source: "ONLINE",
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
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
