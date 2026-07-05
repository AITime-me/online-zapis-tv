import { Suspense } from "react";
import { BookingManageClient } from "@/components/booking/booking-manage-client";
import { bookingTheme } from "@/components/booking/booking-theme";

export const metadata = {
  title: "Управление записью — Твоё время",
  description: "Отмена или перенос онлайн-записи в студии «Твоё время»",
};

export default function BookingManagePage() {
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
          <Suspense
            fallback={
              <p className="text-center text-base text-[#6b7280]">Загрузка…</p>
            }
          >
            <BookingManageClient />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
