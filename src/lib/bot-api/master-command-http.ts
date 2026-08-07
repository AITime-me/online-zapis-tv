/**
 * Shared JSON helpers for Master Command internal bot routes.
 */
import type { MasterCommandErrorCode } from "@/lib/bot-api/master-command-types";
import {
  masterCommandDefaultHttpStatus,
  masterCommandFixedErrorMessage,
} from "@/lib/bot-api/master-command-types";
import { NextResponse } from "next/server";

export const MASTER_COMMAND_JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
} as const;

export function masterCommandErrorResponse(
  code: MasterCommandErrorCode,
  status?: number,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      code,
      error: masterCommandFixedErrorMessage(code),
    },
    {
      status: status ?? masterCommandDefaultHttpStatus(code),
      headers: MASTER_COMMAND_JSON_HEADERS,
    },
  );
}

export function masterCommandSuccessResponse(body: unknown): NextResponse {
  return NextResponse.json(body, {
    status: 200,
    headers: MASTER_COMMAND_JSON_HEADERS,
  });
}
