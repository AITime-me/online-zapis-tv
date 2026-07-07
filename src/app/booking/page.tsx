import { BookingWizard } from "@/components/booking/booking-wizard";
import {
  BookingBrandShell,
  BookingHeader,
  BookingHero,
} from "@/components/booking/booking-ui";

export const metadata = {
  title: "Онлайн-запись — Твоё время",
  description: "Запишитесь на услугу в студии красоты «Твоё время»",
};

export default function BookingPage() {
  return (
    <BookingBrandShell>
      <BookingHeader />
      <main className="booking-page-main mx-auto min-w-0 max-w-3xl px-4 pb-12 md:px-6 md:pb-16">
        <BookingHero />
        <BookingWizard />
      </main>
    </BookingBrandShell>
  );
}
