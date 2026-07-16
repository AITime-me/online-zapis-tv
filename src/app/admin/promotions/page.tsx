import { requireAdminSection } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PromotionsPanel } from "@/components/admin/promotions-panel";
import { listPromotionRulesForAdmin } from "@/services/PromotionAdminService";
import {
  listPromotionServiceOptions,
  listPromotionsForAdmin,
} from "@/services/PromotionCrudService";

export default async function PromotionsAdminPage() {
  const user = await requireAdminSection("promotions");

  const [promotions, services, builtInRules] = await Promise.all([
    listPromotionsForAdmin(),
    listPromotionServiceOptions(),
    Promise.resolve(listPromotionRulesForAdmin()),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title="Акции и подарки"
        description="Встроенные правила расчёта и редактируемые карточки для карусели главной страницы."
        current="promotions"
        role={user.role}
      />

      <PromotionsPanel
        initialPromotions={promotions}
        initialServices={services}
        builtInRules={builtInRules}
      />
    </main>
  );
}
