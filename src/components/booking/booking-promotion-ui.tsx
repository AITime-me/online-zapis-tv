import { bookingTheme } from "@/components/booking/booking-theme";
import type {
  RulesEngineConfirmSection,
  RulesEngineResult,
} from "@/lib/promo/rules-engine";

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

export function BookingRulesPriceSummary({
  rulesResult,
}: {
  rulesResult: RulesEngineResult;
}) {
  const { price, promos } = rulesResult;
  const hasDiscount =
    price.finalLabel != null &&
    price.originalLabel != null &&
    price.finalLabel !== price.originalLabel;
  const primaryMessage = promos.find((promo) => promo.type === "DISCOUNT")?.message;

  if (!price.originalLabel && promos.length === 0 && rulesResult.gifts.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 text-sm">
      {price.originalLabel ? (
        <div className="flex items-start justify-between gap-4">
          <span className="text-zinc-500">Цена</span>
          <div className="text-right">
            {hasDiscount ? (
              <div className="space-y-0.5">
                <div className="text-zinc-400 line-through">{price.originalLabel}</div>
                <div className="font-semibold text-zinc-900">{price.finalLabel}</div>
              </div>
            ) : (
              <span className="font-medium text-zinc-900">{price.originalLabel}</span>
            )}
          </div>
        </div>
      ) : null}
      {hasDiscount && primaryMessage ? (
        <p className="text-xs leading-relaxed text-[#6b7280]">{primaryMessage}</p>
      ) : null}
      {rulesResult.gifts.length > 0 ? (
        <div className="space-y-1">
          {rulesResult.gifts.map((gift) => (
            <p
              key={`${gift.serviceId}-${gift.title}`}
              className="text-xs leading-relaxed text-[#6b7280]"
            >
              Подарок: {gift.title}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** @deprecated Используйте BookingRulesPriceSummary. */
export const BookingPromoPriceSummary = BookingRulesPriceSummary;

export function BookingRulesConfirmBlock({
  sections,
}: {
  sections: RulesEngineConfirmSection[];
}) {
  if (sections.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {sections.map((section) => (
        <section
          key={section.id}
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
            {section.title}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-[#6b7280] md:text-base">
            {section.description}
          </p>
        </section>
      ))}
    </div>
  );
}

/** @deprecated Используйте BookingRulesConfirmBlock. */
export function BookingPromotionConfirmBlock({
  promotions,
}: {
  promotions: Array<{ id: string; title: string; description: string }>;
}) {
  return (
    <BookingRulesConfirmBlock
      sections={promotions.map((promotion) => ({
        id: promotion.id,
        title: promotion.title,
        description: promotion.description,
      }))}
    />
  );
}
