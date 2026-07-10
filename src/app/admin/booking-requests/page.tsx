import { requireAdminSection } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { BookingRequestsPanel } from "@/components/admin/booking-requests-panel";
import { listBookingRequestsPaginated } from "@/services/BookingRequestService";

export default async function BookingRequestsAdminPage() {
  const user = await requireAdminSection("booking-requests");

  const initialActive = await listBookingRequestsPaginated({
    section: "active",
    page: 1,
    pageSize: 25,
    statusFilter: "ACTIVE",
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title="Заявки онлайн-записи"
        description="Заявки через менеджера и консультации с сайта"
        current="booking-requests"
        role={user.role}
      />

      <BookingRequestsPanel
        initialActiveRequests={initialActive.requests}
        initialActiveTotal={initialActive.activeTotal}
        initialActivePage={initialActive.page}
        initialActivePageSize={initialActive.pageSize}
        initialClosedTotal={initialActive.closedTotal}
      />
    </main>
  );
}
