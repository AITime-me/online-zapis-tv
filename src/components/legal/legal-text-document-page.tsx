import Link from "next/link";
import { bookingTheme } from "@/components/booking/booking-theme";
import { getLegalDocumentUpdatedLabel } from "@/services/LegalDocumentService";
import type { PublicLegalDocumentDto } from "@/types/legal-document";

type LegalTextDocumentPageProps = {
  document: PublicLegalDocumentDto;
  backHref?: string;
  backLabel?: string;
};

export function LegalUnavailablePage({
  title,
  backHref = "/",
  backLabel = "На главную",
}: {
  title: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <main
      className="min-h-screen px-4 py-6 md:px-6 md:py-10"
      style={{ backgroundColor: bookingTheme.surface }}
    >
      <article className="mx-auto max-w-2xl">
        <Link
          href={backHref}
          className="font-body mb-6 inline-block text-sm transition hover:opacity-80"
          style={{ color: bookingTheme.textMuted }}
        >
          ← {backLabel}
        </Link>
        <div
          className="font-body rounded-2xl border px-5 py-8 text-center text-sm md:px-8 md:text-base"
          style={{
            borderColor: bookingTheme.border,
            backgroundColor: bookingTheme.card,
            color: bookingTheme.greenMuted,
          }}
        >
          <h1
            className="font-display mb-3 text-xl font-semibold md:text-2xl"
            style={{ color: bookingTheme.green }}
          >
            {title}
          </h1>
          <p>Документ временно недоступен. Попробуйте открыть страницу позже.</p>
        </div>
      </article>
    </main>
  );
}

export function LegalTextDocumentPage({
  document,
  backHref = "/booking",
  backLabel,
}: LegalTextDocumentPageProps) {
  const resolvedBackLabel =
    backLabel ?? (backHref === "/" ? "На главную" : "К онлайн-записи");

  return (
    <main
      className="min-h-screen px-4 py-6 md:px-6 md:py-10"
      style={{ backgroundColor: bookingTheme.surface }}
    >
      <article className="mx-auto max-w-2xl">
        <Link
          href={backHref}
          className="font-body mb-6 inline-block text-sm transition hover:opacity-80"
          style={{ color: bookingTheme.textMuted }}
        >
          ← {resolvedBackLabel}
        </Link>

        <header className="mb-8">
          <p
            className="font-body text-xs font-medium uppercase tracking-[0.25em]"
            style={{ color: bookingTheme.gold }}
          >
            Твоё время
          </p>
          <h1
            className="font-display mt-2 text-2xl font-semibold leading-tight md:text-3xl"
            style={{ color: bookingTheme.green }}
          >
            {document.title}
          </h1>
          <p className="font-body mt-2 text-sm" style={{ color: bookingTheme.textMuted }}>
            Дата публикации: {getLegalDocumentUpdatedLabel(document.updatedAt)}
          </p>
        </header>

        <div
          className="font-body whitespace-pre-wrap rounded-2xl border px-5 py-6 text-sm leading-relaxed md:px-8 md:py-8 md:text-base"
          style={{
            borderColor: bookingTheme.border,
            backgroundColor: bookingTheme.card,
            color: bookingTheme.greenMuted,
          }}
        >
          {document.content}
        </div>
      </article>
    </main>
  );
}
