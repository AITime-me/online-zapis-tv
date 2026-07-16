/**
 * VK connector / worker readiness — без токенов и сетевых вызовов.
 * На текущем этапе отправка всегда заблокирована.
 */

export const COMMUNICATIONS_VK_NOT_CONNECTED_MESSAGE =
  "VK не подключён. Реальная отправка сообщений недоступна.";

export type CommunicationsConnectorState = {
  vkConnectorReady: boolean;
  workerReady: boolean;
  canSchedule: boolean;
  canRun: boolean;
  canTestSend: boolean;
  message: string;
};

export function resolveCommunicationsConnectorState(
  _vkConnectorReadyFlagFromDb?: boolean,
  _workerReadyFlagFromDb?: boolean,
): CommunicationsConnectorState {
  return {
    vkConnectorReady: false,
    workerReady: false,
    canSchedule: false,
    canRun: false,
    canTestSend: false,
    message: COMMUNICATIONS_VK_NOT_CONNECTED_MESSAGE,
  };
}

export function assertCanTransitionCampaignStatus(
  targetStatus: string,
  connector: CommunicationsConnectorState = resolveCommunicationsConnectorState(),
): void {
  if (targetStatus === "SCHEDULED" || targetStatus === "RUNNING") {
    if (
      !connector.canSchedule ||
      !connector.canRun ||
      !connector.vkConnectorReady ||
      !connector.workerReady
    ) {
      throw new Error(
        "Переход в SCHEDULED/RUNNING заблокирован: VK-коннектор или worker не готовы.",
      );
    }
  }
}
