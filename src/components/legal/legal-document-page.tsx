import Link from "next/link";
import { bookingTheme } from "@/components/booking/booking-theme";
import type { LegalDocument } from "@/content/legal/types";

type LegalDocumentPageProps = {
  document: LegalDocument;
  backHref?: string;
};

export function LegalDocumentPage({
  document,
  backHref = "/booking",
}: LegalDocumentPageProps) {
  return (
    <main
      className="min-h-screen px-4 py-6 md:px-6 md:py-10"
      style={{ backgroundColor: bookingTheme.surface }}
    >
      <article className="mx-auto max-w-2xl">
        <Link
          href={backHref}
          className="mb-6 inline-block text-sm transition hover:opacity-80"
          style={{ color: bookingTheme.textMuted }}
        >
          ← К онлайн-записи
        </Link>

        <header className="mb-8">
          <p
            className="text-xs font-medium uppercase tracking-[0.25em]"
            style={{ color: bookingTheme.gold }}
          >
            Твоё время
          </p>
          <h1
            className="mt-2 text-2xl font-semibold leading-tight md:text-3xl"
            style={{ color: bookingTheme.green }}
          >
            {document.title}
          </h1>
          {document.subtitle && (
            <p className="mt-2 text-base" style={{ color: bookingTheme.textMuted }}>
              {document.subtitle}
            </p>
          )}
          <p className="mt-2 text-sm" style={{ color: bookingTheme.textMuted }}>
            Дата публикации: {document.updatedAt}
          </p>
        </header>

        <div
          className="space-y-8 rounded-2xl border px-5 py-6 text-sm leading-relaxed md:px-8 md:py-8 md:text-base"
          style={{
            borderColor: bookingTheme.border,
            backgroundColor: bookingTheme.card,
            color: "#374151",
          }}
        >
          {document.sections.map((section) => (
            <section key={section.title} className="space-y-3">
              <h2
                className="text-base font-semibold md:text-lg"
                style={{ color: bookingTheme.green }}
              >
                {section.title}
              </h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.bullets && section.bullets.length > 0 && (
                <ul className="list-disc space-y-1 pl-5">
                  {section.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
