/**
 * VK connector readiness — foundation без токенов и сетевых вызовов.
 * На этапе 1 отправка всегда заблокирована независимо от флага в БД.
 */

export const COMMUNICATIONS_VK_NOT_CONNECTED_MESSAGE =
  "VK не подключён. Реальная отправка сообщений недоступна.";

export type CommunicationsConnectorState = {
  vkConnectorReady: boolean;
  canSchedule: boolean;
  canRun: boolean;
  message: string;
};

export function resolveCommunicationsConnectorState(
  _vkConnectorReadyFlagFromDb?: boolean,
): CommunicationsConnectorState {
  return {
    vkConnectorReady: false,
    canSchedule: false,
    canRun: false,
    message: COMMUNICATIONS_VK_NOT_CONNECTED_MESSAGE,
  };
}

export function assertCanTransitionCampaignStatus(
  targetStatus: string,
  connector: CommunicationsConnectorState = resolveCommunicationsConnectorState(),
): void {
  if (targetStatus === "SCHEDULED" || targetStatus === "RUNNING") {
    if (!connector.canSchedule || !connector.canRun || !connector.vkConnectorReady) {
      throw new Error(
        "Переход в SCHEDULED/RUNNING заблокирован: VK-коннектор не подключён.",
      );
    }
  }
}
