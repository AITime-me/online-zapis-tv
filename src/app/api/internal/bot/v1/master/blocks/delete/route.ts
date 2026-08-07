import { withBotInternalApi } from "@/lib/auth/bot-internal-api";
import {
  BOT_INTERNAL_MAX_JSON_BODY_BYTES,
  readBoundedJsonBody,
} from "@/lib/bot-api/bounded-json-body";
import {
  masterCommandErrorResponse,
  masterCommandSuccessResponse,
} from "@/lib/bot-api/master-command-http";
import {
  isExactApplicationJsonContentType,
  parseMasterDeleteBlockBody,
} from "@/lib/bot-api/master-command-types";
import { safeLogError } from "@/lib/logging/redact";
import { masterDeleteBlock } from "@/services/MasterCommandService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const POST = withBotInternalApi(
  async (request: Request) => {
    if (!isExactApplicationJsonContentType(request.headers.get("content-type"))) {
      return masterCommandErrorResponse("VALIDATION_ERROR", 400);
    }

    const bodyResult = await readBoundedJsonBody(
      request,
      BOT_INTERNAL_MAX_JSON_BODY_BYTES,
    );
    if (!bodyResult.ok) {
      if (bodyResult.code === "PAYLOAD_TOO_LARGE") {
        return masterCommandErrorResponse("PAYLOAD_TOO_LARGE", 413);
      }
      return masterCommandErrorResponse("VALIDATION_ERROR", 400);
    }

    const parsed = parseMasterDeleteBlockBody(bodyResult.value);
    if (!parsed.ok) {
      return masterCommandErrorResponse("VALIDATION_ERROR", 400);
    }

    try {
      const result = await masterDeleteBlock(parsed.value);
      if (!result.ok) {
        return masterCommandErrorResponse(result.code, result.httpStatus);
      }
      return masterCommandSuccessResponse(result.body);
    } catch (error) {
      safeLogError("bot-internal-master-delete-block", error);
      return masterCommandErrorResponse("INTERNAL_ERROR", 500);
    }
  },
  { rateLimitPolicy: "botInternalMasterCommand" },
);
