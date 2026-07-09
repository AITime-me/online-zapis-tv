import type { ClientStatus } from "@prisma/client";

export type ClientAdminDto = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  gender: string | null;
  source: string | null;
  status: ClientStatus;
  notes: string | null;
  tags: string[];
  isArchived: boolean;
  loyaltyLevel: string | null;
  bonusBalance: number;
  totalSpent: number;
  lastVisitAt: string | null;
  lastContactAt: string | null;
  createdAt: string;
  updatedAt: string;
  bookingRequestCount: number;
  lastBookingRequestAt: string | null;
  hasActiveDuplicate: boolean;
  mergedIntoClientId: string | null;
  mergedIntoClientName: string | null;
};

export type ClientAdminCreateInput = {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  birthDate?: string | null;
  gender?: string | null;
  source?: string | null;
  status?: ClientStatus;
  notes?: string | null;
  tags?: string[];
  loyaltyLevel?: string | null;
  bonusBalance?: number;
  totalSpent?: number;
  lastVisitAt?: string | null;
  lastContactAt?: string | null;
};

export type ClientAdminUpdateInput = Partial<ClientAdminCreateInput> & {
  isArchived?: boolean;
};

export type ClientAdminPatchBody = ClientAdminUpdateInput & {
  id?: string;
  archive?: boolean;
  restore?: boolean;
};
