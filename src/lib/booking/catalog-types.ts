export type BookingServiceMode = "ONLINE" | "MANAGER_ONLY";

export type BookingCatalogService = {
  id: string;
  publicName: string;
  clientDescription: string | null;
  durationMinutes: number;
  breakAfterMinutes: number;
  priceLabel: string | null;
  basePrice: number | null;
  categoryName?: string | null;
  bookingMode: BookingServiceMode;
  managerMasterId: string | null;
  managerMasterName: string | null;
};

export type BookingCatalogCategory = {
  id: string;
  name: string;
  services: BookingCatalogService[];
};

export type BookingCatalogMaster = {
  id: string;
  publicName: string;
  clientDescription: string | null;
  photoUrl: string | null;
  isOnlineBookingEnabled: boolean;
};
