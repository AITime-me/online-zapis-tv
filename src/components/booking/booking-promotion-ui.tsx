import { bookingTheme } from "@/components/booking/booking-theme";
import type { BookingPromotion } from "@/lib/booking/promotions";

export function BookingPromotionGeneralNotice({ text }: { text: string }) {
  return (
    <p
      className="rounded-xl border px-4 py-3 text-sm leading-relaxed text-[#6b7280] md:text-base"
      style={{
        borderColor: bookingTheme.border,
        backgroundColor: bookingTheme.surface,
      }}
    >
      {text}
    </p>
  );
}

export function BookingPromotionBadge({ text }: { text: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium tracking-wide"
      style={{
        backgroundColor: `${bookingTheme.gold}22`,
        color: bookingTheme.greenMuted,
        border: `1px solid ${bookingTheme.gold}55`,
      }}
    >
      {text}
    </span>
  );
}

export function BookingPromotionCardNote({ text }: { text: string }) {
  return (
    <p
      className="mt-3 rounded-xl px-3 py-2.5 text-sm leading-relaxed"
      style={{
        backgroundColor: `${bookingTheme.gold}14`,
        color: bookingTheme.greenMuted,
      }}
    >
      {text}
    </p>
  );
}

export function BookingPromotionConfirmBlock({
  promotions,
}: {
  promotions: BookingPromotion[];
}) {
  if (promotions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {promotions.map((promotion) => (
        <section
          key={promotion.id}
          className="rounded-2xl border p-4 md:p-5"
          style={{
            borderColor: `${bookingTheme.gold}55`,
            backgroundColor: `${bookingTheme.gold}10`,
          }}
        >
          <p
            className="text-xs font-medium uppercase tracking-[0.15em]"
            style={{ color: bookingTheme.gold }}
          >
            Специальное предложение
          </p>
          <h3
            className="mt-2 text-base font-semibold"
            style={{ color: bookingTheme.green }}
          >
            {promotion.title}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-[#6b7280] md:text-base">
            {promotion.description}
          </p>
        </section>
      ))}
    </div>
  );
}
