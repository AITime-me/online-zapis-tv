export type ScheduleLoadOptions = {
  /** Колонка менеджера: заметки и заявки. В view-only режиме — false. */
  includeManagerColumn?: boolean;
  /** Активные BookingRequest. Только для OWNER/MANAGER во внутреннем расписании. */
  includeBookingRequests?: boolean;
};

export const SCHEDULE_LOAD_INTERNAL: ScheduleLoadOptions = {
  includeManagerColumn: true,
  includeBookingRequests: true,
};

export const SCHEDULE_LOAD_VIEW_ONLY: ScheduleLoadOptions = {
  includeManagerColumn: false,
  includeBookingRequests: false,
};
