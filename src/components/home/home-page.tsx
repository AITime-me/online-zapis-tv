"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useEffect } from "react";
import { studioBrand } from "@/lib/brand/studio-brand";
import {
  HOME_DIRECTIONS,
  HOME_FEATURES,
  HOME_PROMOTIONS,
  HOME_STEPS,
} from "@/components/home/home-data";
import { HomeHeader } from "@/components/home/home-header";
import { HomePromoCarousel } from "@/components/home/home-promo-carousel";
import {
  HomeBrandShell,
  HomeButton,
  HomeCard,
  HomeCtaGroup,
  HomeFooter,
  HomeLegalNotice,
  HomeSection,
} from "@/components/home/home-ui";

function useRevealOnScroll() {
  useEffect(() => {
    const elements = document.querySelectorAll(".home-fade-up");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
          }
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -6% 0px" },
    );

    for (const element of elements) {
      observer.observe(element);
    }

    return () => observer.disconnect();
  }, []);
}

export function HomePage() {
  useRevealOnScroll();

  return (
    <HomeBrandShell>
      <HomeHeader />

      <main>
        <section className="home-fade-up is-visible home-hero relative overflow-hidden px-4 pb-10 pt-8 sm:pb-14 sm:pt-11 md:px-6 md:pb-16 md:pt-16 lg:pb-20 lg:pt-20">
          <div className="home-hero-deco" aria-hidden />
          <div
            className="home-deco-ring -left-10 top-16 hidden h-28 w-28 opacity-30 sm:block md:h-36 md:w-36"
            aria-hidden
          />
          <div
            className="home-deco-hourglass right-6 top-24 hidden opacity-35 md:block lg:right-16"
            aria-hidden
          />
          <div className="home-ornament-corner pointer-events-none absolute right-0 top-6 hidden h-40 w-40 opacity-20 lg:block" aria-hidden />

          <div className="relative mx-auto max-w-3xl text-center">
            <p
              className="font-body text-[0.7rem] font-semibold uppercase tracking-[0.28em] sm:text-xs"
              style={{ color: studioBrand.gold }}
            >
              Студия красоты
            </p>

            <h1
              className="font-display mx-auto mt-4 max-w-[18ch] text-[1.75rem] font-semibold leading-[1.15] sm:mt-5 sm:max-w-none sm:text-4xl md:text-5xl lg:text-[3.1rem]"
              style={{ color: studioBrand.green }}
            >
              Выберите заботу, которую подарите себе сегодня
            </h1>

            <p
              className="font-body mx-auto mt-4 max-w-xl text-sm leading-relaxed sm:mt-5 sm:text-base md:text-lg"
              style={{ color: studioBrand.inkMuted }}
            >
              Подберите процедуру, специалиста и удобное время — без лишних поисков
            </p>

            <div className="mt-8 sm:mt-10">
              <HomeCtaGroup
                centered
                primaryHref="/booking"
                primaryLabel="Записаться онлайн"
                secondaryHref="#directions"
                secondaryLabel="Посмотреть направления"
              />
            </div>
          </div>
        </section>

        <HomeSection
          divider
          className="home-steps-intro !pt-10 sm:!pt-12 md:!pt-16 lg:!pt-20"
          title="Ваш путь к визиту — несколько простых шагов"
          description="Выберите процедуру, специалиста и подходящее время. Мы позаботимся о Вашей записи."
        >
          <div className="home-steps-features-grid grid gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
            {HOME_FEATURES.map((feature, index) => (
              <HomeCard
                key={feature.title}
                variant="info"
                className="home-step-card home-fade-up min-w-0"
                style={{ animationDelay: `${index * 80}ms` } as CSSProperties}
              >
                <p
                  className="font-body text-[0.7rem] font-bold uppercase tracking-[0.18em] sm:text-xs"
                  style={{ color: studioBrand.gold }}
                >
                  ШАГ {String(index + 1).padStart(2, "0")}
                </p>
                <h3
                  className="font-display mt-3 text-lg font-semibold sm:text-xl"
                  style={{ color: studioBrand.green }}
                >
                  {feature.title}
                </h3>
                <p
                  className="font-body mt-3 text-sm leading-relaxed"
                  style={{ color: studioBrand.inkMuted }}
                >
                  {feature.description}
                </p>
              </HomeCard>
            ))}
          </div>
        </HomeSection>

        <HomeSection
          id="directions"
          divider
          eyebrow="Направления"
          title="Направления студии"
        >
          <div className="grid gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
            {HOME_DIRECTIONS.map((direction, index) => (
              <Link
                key={direction.title}
                href="/booking"
                className="home-fade-up group block"
                style={{ animationDelay: `${index * 60}ms` } as CSSProperties}
              >
                <HomeCard variant="direction" className="h-full">
                  <div
                    className="mb-4 h-px w-10 transition-all duration-300 group-hover:w-14"
                    style={{ backgroundColor: studioBrand.gold }}
                  />
                  <h3
                    className="font-display text-lg font-semibold sm:text-xl"
                    style={{ color: studioBrand.green }}
                  >
                    {direction.title}
                  </h3>
                  <p
                    className="font-body mt-3 text-sm leading-relaxed"
                    style={{ color: studioBrand.inkMuted }}
                  >
                    {direction.description}
                  </p>
                  <p
                    className="font-body mt-4 text-[0.7rem] font-semibold uppercase tracking-[0.14em] opacity-70 transition-opacity duration-300 group-hover:opacity-100 sm:mt-5"
                    style={{ color: studioBrand.gold }}
                  >
                    Перейти к выбору
                  </p>
                </HomeCard>
              </Link>
            ))}
          </div>
        </HomeSection>

        <section
          id="promo"
          className="home-fade-up relative overflow-hidden px-4 py-16 sm:py-20 md:px-6 md:py-24"
          style={{ backgroundColor: studioBrand.green }}
        >
          <div className="home-ornament-promo pointer-events-none absolute inset-0 opacity-25" aria-hidden />
          <div
            className="home-deco-ring pointer-events-none absolute -left-16 bottom-8 h-40 w-40 opacity-15"
            aria-hidden
          />
          <div className="relative mx-auto max-w-5xl">
            <header className="mx-auto mb-10 max-w-3xl text-center sm:mb-12">
              <h2 className="font-display text-2xl font-semibold leading-tight text-[#faf7f2] sm:text-3xl md:text-4xl">
                Особенные предложения для Вас
              </h2>
            </header>
            <HomePromoCarousel promotions={HOME_PROMOTIONS} />
          </div>
        </section>

        <section className="home-fade-up px-4 py-16 sm:py-20 md:px-6 md:py-24">
          <div className="mx-auto max-w-4xl">
            <div
              className="home-consultation-block overflow-hidden rounded-[2rem] border px-5 py-9 sm:px-8 sm:py-10 md:px-10 md:py-12"
              style={{
                borderColor: studioBrand.goldLine,
                background:
                  "linear-gradient(145deg, #ffffff 0%, #f8f3ea 52%, #f3ece2 100%)",
                boxShadow: studioBrand.shadowSoft,
              }}
            >
              <div className="home-gold-divider mx-auto mb-7 max-w-xs sm:mb-8" />
              <div className="mx-auto max-w-2xl text-center">
                <h2
                  className="font-display text-2xl font-semibold leading-tight sm:text-3xl md:text-4xl"
                  style={{ color: studioBrand.green }}
                >
                  Не знаете, какая процедура подойдёт именно Вам?
                </h2>
                <p
                  className="font-body mt-4 text-base leading-relaxed sm:mt-5 md:text-lg"
                  style={{ color: studioBrand.inkMuted }}
                >
                  Расскажите, какой результат хочется получить, а мы поможем подобрать
                  подходящее направление.
                </p>
                <div className="mt-8 flex flex-col items-center gap-4">
                  <HomeButton
                    href="/booking"
                    className="w-full sm:w-auto sm:min-w-[220px]"
                  >
                    Получить рекомендацию
                  </HomeButton>
                  <HomeLegalNotice actionLabel="Получить рекомендацию" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <HomeSection
          id="steps"
          divider
          eyebrow="Ваш путь к визиту"
          title="Всего несколько шагов до Вашего визита"
        >
          <ol className="home-steps-route-grid mx-auto grid max-w-4xl gap-3 sm:grid-cols-2 sm:gap-4">
            {HOME_STEPS.map((step, index) => (
              <li key={step} className="min-w-0">
                <HomeCard variant="route" className="home-step-card home-fade-up h-full">
                  <p
                    className="font-body text-[0.7rem] font-bold uppercase tracking-[0.22em] sm:text-xs"
                    style={{ color: studioBrand.gold }}
                  >
                    ШАГ {String(index + 1).padStart(2, "0")}
                  </p>
                  <p
                    className="font-display mt-3 text-lg font-semibold leading-snug sm:text-xl"
                    style={{ color: studioBrand.green }}
                  >
                    {step}
                  </p>
                </HomeCard>
              </li>
            ))}
          </ol>

          <div className="mt-10 flex justify-center">
            <HomeCtaGroup
              centered
              primaryHref="/booking"
              primaryLabel="Перейти к онлайн-записи"
              showLegal={false}
            />
          </div>
        </HomeSection>

        <section className="home-fade-up relative px-4 pb-20 pt-2 sm:pb-24 md:px-6 md:pb-28">
          <div className="home-section-deco" aria-hidden />
          <div className="mx-auto max-w-4xl">
            <HomeCard
              variant="premium"
              className="overflow-hidden px-5 py-10 text-center sm:px-8 sm:py-12 md:px-10 md:py-14"
            >
              <div className="home-ornament-final pointer-events-none absolute inset-0 opacity-50" aria-hidden />
              <div className="relative">
                <p
                  className="font-body text-xs font-semibold uppercase tracking-[0.24em]"
                  style={{ color: studioBrand.gold }}
                >
                  Твоё время — для Вас
                </p>
                <h2
                  className="font-display mx-auto mt-4 max-w-2xl text-2xl font-semibold leading-tight sm:text-3xl md:text-4xl"
                  style={{ color: studioBrand.green }}
                >
                  Один шаг навстречу себе — и Ваш визит запланирован
                </h2>
                <div className="mt-8 sm:mt-9">
                  <HomeCtaGroup
                    centered
                    primaryHref="/booking"
                    primaryLabel="Записаться онлайн"
                  />
                </div>
              </div>
            </HomeCard>
          </div>
        </section>
      </main>

      <HomeFooter />
    </HomeBrandShell>
  );
}
