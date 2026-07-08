"use client";

import { useCallback, useRef, useState, type CSSProperties, type TouchEvent } from "react";
import { StudioLogo } from "@/components/brand/studio-logo";
import {
  HOME_PROMOTION_KIND_LABELS,
  type HomePromotion,
  type HomePromotionKind,
} from "@/components/home/home-data";
import { HomeButton } from "@/components/home/home-ui";
import { studioBrand } from "@/lib/brand/studio-brand";

type HomePromoCarouselProps = {
  promotions: readonly HomePromotion[];
};

const SWIPE_THRESHOLD_PX = 48;

const PROMO_CARD_CLASS: Record<HomePromotionKind, string> = {
  standard: "home-promo-card--standard",
  gift: "home-promo-card--gift",
  game: "home-promo-card--game",
};

function resolvePromotionBadge(promotion: HomePromotion): string {
  return promotion.badgeLabel ?? HOME_PROMOTION_KIND_LABELS[promotion.kind];
}

export function HomePromoCarousel({ promotions }: HomePromoCarouselProps) {
  const activePromotions = [...promotions]
    .filter((item) => item.isActive !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const [activeIndex, setActiveIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const count = activePromotions.length;
  const promotion = activePromotions[activeIndex];

  const goTo = useCallback(
    (index: number) => {
      if (count === 0 || isAnimating) {
        return;
      }
      setIsAnimating(true);
      setActiveIndex((index + count) % count);
      setDragOffset(0);
      window.setTimeout(() => setIsAnimating(false), 320);
    },
    [count, isAnimating],
  );

  const onTouchStart = (event: TouchEvent) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const onTouchMove = (event: TouchEvent) => {
    if (touchStartX.current == null || count <= 1) {
      return;
    }
    const currentX = event.touches[0]?.clientX ?? touchStartX.current;
    setDragOffset(currentX - touchStartX.current);
  };

  const onTouchEnd = () => {
    if (touchStartX.current == null || count <= 1) {
      return;
    }

    if (dragOffset <= -SWIPE_THRESHOLD_PX) {
      goTo(activeIndex + 1);
    } else if (dragOffset >= SWIPE_THRESHOLD_PX) {
      goTo(activeIndex - 1);
    } else {
      setDragOffset(0);
    }

    touchStartX.current = null;
  };

  if (!promotion || count === 0) {
    return null;
  }

  return (
    <div className="home-promo-carousel-shell relative select-none">
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div
          className="home-promo-card-float"
          style={{ "--promo-drag": `${dragOffset}px` } as CSSProperties}
        >
          <article
            className={`home-promo-card ${PROMO_CARD_CLASS[promotion.kind]} relative z-0 rounded-[2rem] px-5 py-9 text-center sm:px-8 md:px-10 md:py-12`}
          >
            <div className="relative z-[1]">
              <p
                className="home-promo-badge font-body mb-5 inline-flex items-center rounded-full border px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em]"
                style={{
                  borderColor: "rgba(201, 169, 106, 0.42)",
                  color: studioBrand.goldMuted,
                }}
              >
                {resolvePromotionBadge(promotion)}
              </p>

              <div className="mb-6 flex justify-center">
                {promotion.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={promotion.imageUrl}
                    alt=""
                    className="mx-auto max-h-24 w-auto max-w-[12rem] object-contain object-center sm:max-h-28"
                  />
                ) : (
                  <StudioLogo variant="gold" size="md" className="mx-auto object-center" />
                )}
              </div>

              <h3 className="font-display text-xl font-semibold leading-tight text-[#faf7f2] sm:text-2xl md:text-3xl">
                {promotion.title}
              </h3>
              <p className="font-body mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-white/78 sm:text-base md:text-lg">
                {promotion.description}
              </p>

              <div className="mt-8 flex justify-center">
                <HomeButton
                  href={promotion.ctaHref}
                  variant={promotion.kind === "game" ? "primary" : "ghost"}
                  className={promotion.kind === "game" ? "sm:min-w-[220px]" : undefined}
                >
                  {promotion.ctaLabel}
                </HomeButton>
              </div>
            </div>
          </article>
        </div>
      </div>

      {count > 1 ? (
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            aria-label="Предыдущая акция"
            onClick={() => goTo(activeIndex - 1)}
            className="font-body text-sm transition hover:opacity-80"
            style={{ color: studioBrand.goldMuted }}
          >
            Назад
          </button>

          <div className="flex items-center gap-2" role="tablist" aria-label="Акции">
            {activePromotions.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-label={`Акция ${index + 1}: ${item.title}`}
                aria-selected={index === activeIndex}
                onClick={() => goTo(index)}
                className="h-2 rounded-full transition-all duration-300"
                style={{
                  width: index === activeIndex ? "1.5rem" : "0.5rem",
                  backgroundColor:
                    index === activeIndex
                      ? studioBrand.gold
                      : "rgba(201, 169, 106, 0.35)",
                }}
              />
            ))}
          </div>

          <button
            type="button"
            aria-label="Следующая акция"
            onClick={() => goTo(activeIndex + 1)}
            className="font-body text-sm transition hover:opacity-80"
            style={{ color: studioBrand.goldMuted }}
          >
            Далее
          </button>
        </div>
      ) : null}
    </div>
  );
}
