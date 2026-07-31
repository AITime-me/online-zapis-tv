/**
 * Публичные сообщения «Проблема на сайте».
 * Метаданные кодируются в comment BookingRequest без отдельной таблицы.
 */

export const PROBLEM_REPORT_SOURCE = "website_problem_report" as const;

export const PROBLEM_REPORT_META_MARKER = "===PROBLEM_REPORT_V1===";

export const PROBLEM_REPORT_MAX_NAME_LENGTH = 100;
export const PROBLEM_REPORT_MAX_DESCRIPTION_LENGTH = 2000;
export const PROBLEM_REPORT_MIN_DESCRIPTION_LENGTH = 3;
export const PROBLEM_REPORT_MAX_PAGE_PATH_LENGTH = 300;
export const PROBLEM_REPORT_MAX_USER_AGENT_LENGTH = 400;

export type ProblemReportClientMeta = {
  pagePath: string;
  userAgent: string;
  viewportWidth: number;
  viewportHeight: number;
};

export type ProblemReportStoredMeta = ProblemReportClientMeta & {
  source: typeof PROBLEM_REPORT_SOURCE;
};

export type ParsedProblemReportComment = {
  description: string;
  meta: ProblemReportStoredMeta | null;
};
