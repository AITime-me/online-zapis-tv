import { DEFAULT_BOT_SETTINGS } from "@/lib/bot-settings/defaults";
import { LEGAL_DOCUMENT_SEEDS } from "@/lib/legal-document/defaults";
import { DEFAULT_STUDIO_SETTINGS } from "@/lib/studio-settings/defaults";

export type ProductionSeedAction =
  | { entity: "StudioSettings"; id: string; action: "create-if-missing" }
  | { entity: "BotSettings"; id: string; action: "create-if-missing" }
  | { entity: "CommunicationSettings"; id: string; action: "create-if-missing" }
  | { entity: "LegalDocument"; slug: string; action: "create-if-missing" }
  | { entity: "GameConfig"; id: string; action: "create-if-missing" }
  | { entity: "GameCatalog"; slug: string; action: "create-if-missing" };

export const PRODUCTION_GAME_CONFIG_ID = "default" as const;
export const PRODUCTION_GAME_CATALOG_SLUG = "procedure-gift" as const;

export function getProductionSeedPlan(): ProductionSeedAction[] {
  const actions: ProductionSeedAction[] = [
    {
      entity: "StudioSettings",
      id: DEFAULT_STUDIO_SETTINGS.id,
      action: "create-if-missing",
    },
    {
      entity: "BotSettings",
      id: DEFAULT_BOT_SETTINGS.id,
      action: "create-if-missing",
    },
    {
      entity: "CommunicationSettings",
      id: "default",
      action: "create-if-missing",
    },
    ...LEGAL_DOCUMENT_SEEDS.map(
      (document) =>
        ({
          entity: "LegalDocument",
          slug: document.slug,
          action: "create-if-missing",
        }) satisfies ProductionSeedAction,
    ),
    {
      entity: "GameConfig",
      id: PRODUCTION_GAME_CONFIG_ID,
      action: "create-if-missing",
    },
    {
      entity: "GameCatalog",
      slug: PRODUCTION_GAME_CATALOG_SLUG,
      action: "create-if-missing",
    },
  ];

  return actions;
}

export function describeProductionSeedAction(action: ProductionSeedAction): string {
  switch (action.entity) {
    case "StudioSettings":
      return `StudioSettings(id=${action.id}): ${action.action} — реквизиты студии по умолчанию (без перезаписи существующих)`;
    case "BotSettings":
      return `BotSettings(id=${action.id}): ${action.action} — бот выключен, каналы отключены, без API-ключей`;
    case "CommunicationSettings":
      return `CommunicationSettings(id=${action.id}): ${action.action} — VK connector выключен, без токенов и рассылок`;
    case "LegalDocument":
      return `LegalDocument(slug=${action.slug}): ${action.action} — юридический документ (create-if-missing, без перезаписи правок владельца)`;
    case "GameConfig":
      return `GameConfig(id=${action.id}): ${action.action} — игра выключена (isActive=false)`;
    case "GameCatalog":
      return `GameCatalog(slug=${action.slug}): ${action.action} — статус DISABLED, связь с legacy GameConfig`;
    default:
      return "unknown action";
  }
}

export function printProductionSeedDryRun(): void {
  console.log("Production seed — dry-run (запись в БД не выполняется)\n");
  console.log("Будут затронуты только технические singleton-записи:\n");

  for (const action of getProductionSeedPlan()) {
    console.log(`  • ${describeProductionSeedAction(action)}`);
  }

  console.log("\nНе создаются: пользователи, клиенты, заявки, записи, мастера, услуги,");
  console.log("расписание, игровые результаты, подарки, акции, тестовые токены,");
  console.log("контакты коммуникаций, получатели и демо-рассылки.");
  console.log("\nПосле первого запуска проверьте реквизиты студии и тексты юридических документов.");
}
