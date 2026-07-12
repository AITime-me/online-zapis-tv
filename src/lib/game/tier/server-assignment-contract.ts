export type CatchTimeServerAssignmentV1 = {
  version: 1;
  mechanicType: "CATCH_TIME";
  serverResultTier: number;
  campaignKey: string | null;
  rulesVersion: string;
  assignedAt: string;
  tierBucket: string;
};

export const SERVER_ASSIGNMENT_VERSION = 1 as const;
