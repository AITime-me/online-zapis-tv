import type { LegalDocument as StaticLegalDocument } from "@/content/legal/types";

export function serializeLegalDocumentContent(
  document: StaticLegalDocument,
): string {
  return document.sections
    .map((section) => {
      const lines: string[] = [section.title];
      if (section.paragraphs?.length) {
        lines.push(...section.paragraphs);
      }
      if (section.bullets?.length) {
        lines.push(...section.bullets.map((item) => `• ${item}`));
      }
      return lines.join("\n");
    })
    .join("\n\n");
}
