export type MasterAdminUser = {
  id: string;
  email: string;
  name: string;
};

export type MasterAdminRow = {
  id: string;
  internalName: string;
  publicName: string;
  clientDescription: string | null;
  workStart: string;
  workEnd: string;
  slotMinutes: number;
  breakAfterMinutes: number;
  sortOrder: number;
  isActive: boolean;
  isPublic: boolean;
  isOnlineBookingEnabled: boolean;
  userId: string | null;
  user: MasterAdminUser | null;
};

export type MasterWriteInput = {
  internalName: string;
  publicName: string;
  clientDescription?: string | null;
  workStart?: string;
  workEnd?: string;
  slotMinutes?: number;
  breakAfterMinutes?: number;
  sortOrder?: number;
  isActive?: boolean;
  isPublic?: boolean;
  isOnlineBookingEnabled?: boolean;
  userId?: string | null;
};

export type MasterReorderItem = {
  id: string;
  sortOrder: number;
};

export type MasterReorderInput = {
  items: MasterReorderItem[];
};
