import { requireAdminSection } from "@/lib/auth/session";
import { canEditBotAdmin } from "@/lib/auth/permissions";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { BotSettingsPanel } from "@/components/admin/bot-settings-panel";
import { getBotSettings } from "@/services/BotSettingsService";
import { buildBotKnowledgeFoundationSummary } from "@/services/BotKnowledgeFoundationService";

export default async function BotAdminPage() {
  const user = await requireAdminSection("bot");
  const [settings, knowledgeSummary] = await Promise.all([
    getBotSettings(),
    buildBotKnowledgeFoundationSummary(),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title="Бот студии"
        description="Control plane внешнего AI Bot Core. Runtime бота не внутри Next.js; сейчас Bot Core не развёрнут, AUTO заблокирован."
        current="bot"
        role={user.role}
      />

      <BotSettingsPanel
        initialSettings={settings}
        knowledgeSummary={knowledgeSummary}
        canEdit={canEditBotAdmin(user.role)}
      />
    </main>
  );
}
