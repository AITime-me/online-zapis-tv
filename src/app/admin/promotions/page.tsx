import { requireAdminSection } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { PromotionsPanel } from "@/components/admin/promotions-panel";
import {
  listPromotionServiceOptions,
  listPromotionsForAdmin,
} from "@/services/PromotionCrudService";

export default async function PromotionsAdminPage() {
  const user = await requireAdminSection("promotions");

  const [promotions, services] = await Promise.all([
    listPromotionsForAdmin(),
    listPromotionServiceOptions(),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title="Акции и подарки"
        description="Управление подарками, сезонными предложениями, бонусами и спецпредложениями студии."
        current="promotions"
        role={user.role}
      />

      <PromotionsPanel
        initialPromotions={promotions}
        initialServices={services}
      />
    </main>
  );
}
