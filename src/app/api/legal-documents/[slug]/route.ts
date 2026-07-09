import { NextResponse } from "next/server";
import { getPublishedLegalDocument } from "@/services/LegalDocumentService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ slug: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const document = await getPublishedLegalDocument(slug);

  if (!document) {
    return NextResponse.json({ ok: false, error: "Документ не найден" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, document });
}
