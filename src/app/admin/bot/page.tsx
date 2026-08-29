import { requireAdminSection } from "@/lib/auth/session";
import { canEditBotAdmin } from "@/lib/auth/permissions";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { BotSettingsPanel } from "@/components/admin/bot-settings-panel";
import { BotKnowledgePanel } from "@/components/admin/bot-knowledge-panel";
import { getBotSettings } from "@/services/BotSettingsService";
import { getBotSettingsPublicationState } from "@/services/BotSettingsPublicationService";
import { buildBotKnowledgeFoundationSummary } from "@/services/BotKnowledgeFoundationService";
import {
  listBotKnowledgeEntries,
  listBotKnowledgeServiceOptions,
} from "@/services/BotKnowledgeEntryService";
import { getBotKnowledgePublicationState } from "@/services/BotKnowledgePublicationService";

export default async function BotAdminPage() {
  const user = await requireAdminSection("bot");
  const [
    settings,
    knowledgeSummary,
    publicationState,
    knowledgeEntries,
    knowledgePublicationState,
    knowledgeServiceOptions,
  ] = await Promise.all([
    getBotSettings(),
    buildBotKnowledgeFoundationSummary(),
    getBotSettingsPublicationState(),
    listBotKnowledgeEntries(),
    getBotKnowledgePublicationState(),
    listBotKnowledgeServiceOptions(),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title="Бот студии"
        description="Управление настройками, публикациями и базой знаний Теи."
        current="bot"
        role={user.role}
      />

      <BotSettingsPanel
        initialSettings={settings}
        initialPublicationState={publicationState}
        knowledgePublicationState={knowledgePublicationState}
        knowledgeSummary={knowledgeSummary}
        canEdit={canEditBotAdmin(user.role)}
      />

      <BotKnowledgePanel
        initialEntries={knowledgeEntries}
        initialPublicationState={knowledgePublicationState}
        serviceOptions={knowledgeServiceOptions}
        canEdit={canEditBotAdmin(user.role)}
      />
    </main>
  );
}
