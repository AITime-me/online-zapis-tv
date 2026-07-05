export type LegalDocumentSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type LegalDocument = {
  title: string;
  subtitle?: string;
  updatedAt: string;
  sections: LegalDocumentSection[];
};
