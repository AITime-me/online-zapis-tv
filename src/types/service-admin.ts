export type ServiceAdminMasterLink = {
  masterId: string;
  masterInternalName: string;
  masterPublicName: string;
  isEnabled: boolean;
  isPublic: boolean;
  isOnlineBookingEnabled: boolean;
};

export type ServiceAdminRow = {
  id: string;
  categoryId: string;
  categoryName: string;
  internalName: string;
  publicName: string;
  clientDescription: string | null;
  price: number | null;
  priceFrom: number | null;
  priceTo: number | null;
  durationMinutes: number;
  breakAfterMinutes: number;
  sortOrder: number;
  isActive: boolean;
  isPublic: boolean;
  isOnlineBookingEnabled: boolean;
  masters: ServiceAdminMasterLink[];
};

export type ServiceCategoryOption = {
  id: string;
  name: string;
  sortOrder: number;
};

export type ServiceMasterOption = {
  id: string;
  internalName: string;
  publicName: string;
  isActive: boolean;
};

export type ServiceWriteInput = {
  internalName: string;
  publicName: string;
  clientDescription?: string | null;
  categoryId: string;
  priceFrom?: number | null;
  priceTo?: number | null;
  durationMinutes: number;
  breakAfterMinutes?: number;
  sortOrder?: number;
  isActive?: boolean;
  isPublic?: boolean;
  isOnlineBookingEnabled?: boolean;
  masterIds?: string[];
};
