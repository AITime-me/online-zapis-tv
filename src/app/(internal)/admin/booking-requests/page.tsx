import { requireRole } from "@/lib/auth/session";
import { AdminNavLinks } from "@/components/admin/admin-nav";
import { BookingRequestsPanel } from "@/components/admin/booking-requests-panel";
import { listBookingRequests } from "@/services/BookingRequestService";

export default async function BookingRequestsAdminPage() {
  await requireRole(["OWNER", "MANAGER"]);

  const requests = await listBookingRequests();

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#dadce0] bg-white px-4 py-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">
            Заявки онлайн-записи
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Заявки через менеджера и консультации с сайта
          </p>
        </div>
        <AdminNavLinks current="booking-requests" />
      </header>

      <BookingRequestsPanel initialRequests={requests} />
    </main>
  );
}
