import { NextResponse } from "next/server";
import { issueAcquisitionEvidenceForLinkToken } from "@/services/AcquisitionAttributionService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ token: string }>;
};

function redirect(request: Request, targetPath: string): NextResponse {
  const response = NextResponse.redirect(new URL(targetPath, request.url), 302);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const issued = await issueAcquisitionEvidenceForLinkToken(token);
  if (!issued) {
    return redirect(request, "/");
  }

  return redirect(request, issued.redirectPath);
}
