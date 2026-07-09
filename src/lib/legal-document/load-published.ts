import { getPublishedLegalDocument } from "@/services/LegalDocumentService";
import type { PublicLegalDocumentDto } from "@/types/legal-document";

export async function loadPublishedLegalDocument(
  slug: string,
): Promise<PublicLegalDocumentDto | null> {
  try {
    return await getPublishedLegalDocument(slug);
  } catch {
    return null;
  }
}
