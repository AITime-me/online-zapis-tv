import { requireRole } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
  PromotionsDetailsList,
  PromotionsTable,
} from "@/components/admin/promotions-table";
import {
  getPromotionAdminSummary,
  listPromotionRulesForAdmin,
} from "@/services/PromotionAdminService";

export default async function PromotionsAdminPage() {
  await requireRole(["OWNER", "MANAGER"]);

  const rules = listPromotionRulesForAdmin();
  const summary = getPromotionAdminSummary(rules);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title="Акции и подарки"
        description="Правила, которые применяются в онлайн-записи и отображаются в расписании."
        current="promotions"
      />

      <section className="rounded border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Режим просмотра (MVP): правила читаются из текущего promo-engine /
        gift-engine. Редактирование и включение/выключение без правки кода будет
        подключено следующим этапом.
      </section>

      <section className="flex flex-wrap gap-4 text-sm text-zinc-600">
        <span>Всего правил: {summary.total}</span>
        <span>Активных: {summary.active}</span>
        <span>Выключенных: {summary.inactive}</span>
      </section>

      <PromotionsTable rules={rules} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Детали правил
        </h2>
        <PromotionsDetailsList rules={rules} />
      </section>
    </main>
  );
}
