import { connection } from "next/server";
import { BookingManageClient } from "@/components/booking/booking-manage-client";
import { bookingTheme } from "@/components/booking/booking-theme";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Управление записью — Твоё время",
  description: "Отмена или перенос онлайн-записи в студии «Твоё время»",
};

/**
 * Bearer manage-link UI. Dynamic + no-store.
 * Deep links keep `?token=` for SMS/share; middleware moves the bearer into an
 * httpOnly cookie and redirects to `/booking/manage` without the query, so the
 * rendered RSC/HTML flight does not embed the secret.
 */
export default async function BookingManagePage() {
  await connection();

  return (
    <main
      className="min-h-screen px-3 py-6 md:px-6"
      style={{ backgroundColor: bookingTheme.surface }}
    >
      <div className="mx-auto max-w-2xl">
        <header className="mb-8 text-center">
          <p
            className="text-xs font-medium uppercase tracking-[0.25em]"
            style={{ color: bookingTheme.gold }}
          >
            Твоё время
          </p>
        </header>
        <div
          className="rounded-2xl border p-5 md:p-8"
          style={{
            borderColor: bookingTheme.border,
            backgroundColor: bookingTheme.card,
          }}
        >
          <BookingManageClient />
        </div>
      </div>
    </main>
  );
}
