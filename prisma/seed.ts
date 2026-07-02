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

async function main() {
  const passwordHash = await bcrypt.hash("dev-password", 10);

  const owner = await prisma.user.upsert({
    where: { email: "owner@example.local" },
    update: {},
    create: {
      email: "owner@example.local",
      passwordHash,
      role: "OWNER",
      name: "Тестовый владелец",
    },
  });

  const manager = await prisma.user.upsert({
    where: { email: "manager@example.local" },
    update: {},
    create: {
      email: "manager@example.local",
      passwordHash,
      role: "MANAGER",
      name: "Тестовый менеджер",
    },
  });

  const masterUser1 = await prisma.user.upsert({
    where: { email: "master1@example.local" },
    update: {},
    create: {
      email: "master1@example.local",
      passwordHash,
      role: "MASTER",
      name: "Тестовый мастер 1",
    },
  });

  const masterUser2 = await prisma.user.upsert({
    where: { email: "master2@example.local" },
    update: {},
    create: {
      email: "master2@example.local",
      passwordHash,
      role: "MASTER",
      name: "Тестовый мастер 2",
    },
  });

  const master1 = await prisma.master.upsert({
    where: { userId: masterUser1.id },
    update: {},
    create: {
      userId: masterUser1.id,
      displayName: "Анна (тест)",
      slotMinutes: 30,
      workStart: "09:00",
      workEnd: "18:00",
      breakAfterMinutes: 15,
      sortOrder: 1,
    },
  });

  const master2 = await prisma.master.upsert({
    where: { userId: masterUser2.id },
    update: {},
    create: {
      userId: masterUser2.id,
      displayName: "Мария (тест)",
      slotMinutes: 15,
      workStart: "10:00",
      workEnd: "19:00",
      breakAfterMinutes: 10,
      sortOrder: 2,
    },
  });

  const categoryHair = await prisma.serviceCategory.upsert({
    where: { id: "00000000-0000-4000-8000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Волосы",
      sortOrder: 1,
    },
  });

  const categoryNails = await prisma.serviceCategory.upsert({
    where: { id: "00000000-0000-4000-8000-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Ногти",
      sortOrder: 2,
    },
  });

  const serviceHaircut = await prisma.service.upsert({
    where: { id: "00000000-0000-4000-8000-000000000101" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000101",
      categoryId: categoryHair.id,
      name: "Стрижка (тест)",
      durationMinutes: 60,
      breakAfterMinutes: 15,
      price: 1500,
      isPublic: true,
    },
  });

  const serviceManicure = await prisma.service.upsert({
    where: { id: "00000000-0000-4000-8000-000000000102" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000102",
      categoryId: categoryNails.id,
      name: "Маникюр (тест)",
      durationMinutes: 90,
      breakAfterMinutes: 10,
      price: 2000,
      isPublic: true,
    },
  });

  await prisma.serviceSynonym.upsert({
    where: {
      serviceId_synonym: {
        serviceId: serviceHaircut.id,
        synonym: "подстричься",
      },
    },
    update: {},
    create: {
      serviceId: serviceHaircut.id,
      synonym: "подстричься",
    },
  });

  await prisma.serviceSynonym.upsert({
    where: {
      serviceId_synonym: {
        serviceId: serviceHaircut.id,
        synonym: "стрижка",
      },
    },
    update: {},
    create: {
      serviceId: serviceHaircut.id,
      synonym: "стрижка",
    },
  });

  await prisma.serviceSynonym.upsert({
    where: {
      serviceId_synonym: {
        serviceId: serviceManicure.id,
        synonym: "маникюр",
      },
    },
    update: {},
    create: {
      serviceId: serviceManicure.id,
      synonym: "маникюр",
    },
  });

  await prisma.masterService.upsert({
    where: {
      masterId_serviceId: {
        masterId: master1.id,
        serviceId: serviceHaircut.id,
      },
    },
    update: {},
    create: {
      masterId: master1.id,
      serviceId: serviceHaircut.id,
    },
  });

  await prisma.masterService.upsert({
    where: {
      masterId_serviceId: {
        masterId: master2.id,
        serviceId: serviceManicure.id,
      },
    },
    update: {},
    create: {
      masterId: master2.id,
      serviceId: serviceManicure.id,
    },
  });

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

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
    update: {},
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
  console.log(`Masters: ${master1.displayName}, ${master2.displayName}`);
  console.log(`Services: ${serviceHaircut.name}, ${serviceManicure.name}`);
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
