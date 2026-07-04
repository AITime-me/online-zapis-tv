import { BookingWizard } from "@/components/booking/booking-wizard";
import { bookingTheme } from "@/components/booking/booking-theme";

export const metadata = {
  title: "Онлайн-запись — Твоё время",
  description: "Запишитесь на услугу в студии красоты «Твоё время»",
};

export default function BookingPage() {
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
          <h1
            className="mt-2 text-2xl font-semibold md:text-3xl"
            style={{ color: bookingTheme.green }}
          >
            Онлайн-запись
          </h1>
          <p className="mt-2 text-base text-[#6b7280]">
            Студия красоты
          </p>
        </header>
        <BookingWizard />
      </div>
    </main>
  );
}
