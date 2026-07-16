/**
 * Честная семантика статуса прочтения: без подтверждения нельзя говорить «не прочитано».
 */

export type CommReadStatusSemantics =
  | "read_confirmed"
  | "read_not_confirmed";

export const COMM_READ_STATUS_LABELS: Record<CommReadStatusSemantics, string> =
  {
    read_confirmed: "Прочтение подтверждено",
    read_not_confirmed: "Статус прочтения не подтверждён",
  };

export const COMM_CHANNEL_ACCEPT_LABEL = "Принято VK";

export function resolveReadStatusSemantics(hasReadConfirmed: boolean): {
  status: CommReadStatusSemantics;
  label: string;
} {
  if (hasReadConfirmed) {
    return {
      status: "read_confirmed",
      label: COMM_READ_STATUS_LABELS.read_confirmed,
    };
  }
  return {
    status: "read_not_confirmed",
    label: COMM_READ_STATUS_LABELS.read_not_confirmed,
  };
}
