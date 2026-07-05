import { requireRole } from "@/lib/auth/session";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { BookingRequestsPanel } from "@/components/admin/booking-requests-panel";
import { listBookingRequests } from "@/services/BookingRequestService";

export default async function BookingRequestsAdminPage() {
  await requireRole(["OWNER", "MANAGER"]);

  const requests = await listBookingRequests();

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <AdminPageHeader
        title="Заявки онлайн-записи"
        description="Заявки через менеджера и консультации с сайта"
        current="booking-requests"
      />

      <BookingRequestsPanel initialRequests={requests} />
    </main>
  );
}
