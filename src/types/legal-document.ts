export type LegalDocumentDto = {
  id: string;
  slug: string;
  title: string;
  content: string;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LegalDocumentListItemDto = Pick<
  LegalDocumentDto,
  "id" | "slug" | "title" | "isPublished" | "updatedAt"
>;

export type LegalDocumentWriteInput = {
  title?: string;
  content?: string;
  isPublished?: boolean;
};

export type PublicLegalDocumentDto = Pick<
  LegalDocumentDto,
  "slug" | "title" | "content" | "updatedAt"
>;
