import { requireAdminSection } from "@/lib/auth/session";
import { canEditBotAdmin } from "@/lib/auth/permissions";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { BotSettingsPanel } from "@/components/admin/bot-settings-panel";
import { getBotSettings } from "@/services/BotSettingsService";

export default async function BotAdminPage() {
  const user = await requireAdminSection("bot");
  const settings = await getBotSettings();

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title="Бот студии"
        description="Настройки будущего AI-бота. Сейчас это foundation: бот не отправляет сообщения клиентам."
        current="bot"
        role={user.role}
      />

      <BotSettingsPanel
        initialSettings={settings}
        canEdit={canEditBotAdmin(user.role)}
      />
    </main>
  );
}
