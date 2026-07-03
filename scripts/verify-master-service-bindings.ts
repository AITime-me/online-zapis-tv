import { PrismaClient } from "@prisma/client";
import { getScheduleEditorOptions } from "@/services/ScheduleEditorOptionsService";
import { listServices } from "@/services/ServiceAdminService";

const prisma = new PrismaClient();

const KOM = "Комплекс омоложения кожи рук";
const VEL = "Реконструкция ресниц Velvet / Вельвет ресниц";
const KSENIA = "c335a305-de17-4684-956e-9afe5ce66488";
const TATYANA = "c36cdbb1-ca0d-4f3a-a607-c6367b1f52ef";
const IRINA = "2023370c-7639-4214-9bf9-a4448c039b61";

function isActive(link: {
  isEnabled: boolean;
  isPublic: boolean;
  isOnlineBookingEnabled: boolean;
}): boolean {
  return link.isEnabled && link.isPublic && link.isOnlineBookingEnabled;
}

async function main() {
  for (const name of [KOM, VEL]) {
    const service = await prisma.service.findFirst({
      where: { publicName: name },
      include: {
        masterServices: {
          include: { master: { select: { internalName: true } } },
        },
      },
    });
    console.log(`\nDB: ${name}`);
    for (const link of service!.masterServices) {
      console.log(
        `  ${link.master.internalName}: ${isActive(link) ? "ACTIVE" : "inactive"}`,
      );
    }
  }

  const services = await listServices();
  for (const name of [KOM, VEL]) {
    const row = services.find((service) => service.publicName === name)!;
    const enabled = row.masters
      .filter((master) => master.isEnabled)
      .map((master) => master.masterInternalName);
    console.log(`\nADMIN: ${name} → ${enabled.join(", ") || "(none)"}`);
  }

  for (const [label, id] of [
    ["Ксения", KSENIA],
    ["Татьяна", TATYANA],
    ["Ирина Б", IRINA],
  ] as const) {
    const options = await getScheduleEditorOptions(id, "2026-07-03");
    const names = options!.services.map((service) => service.publicName);
    console.log(
      `\nEDITOR ${label}: KOM=${names.includes(KOM)}, VEL=${names.includes(VEL)}`,
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
