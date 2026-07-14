import { after, NextResponse } from "next/server";
import { isSyntacticallyValidPasswordResetEmail } from "@/lib/auth/password-reset";
import { PASSWORD_RESET_NEUTRAL_MESSAGE } from "@/lib/auth/password-reset-messages";
import { requestPasswordResetByEmail } from "@/services/PasswordResetService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ForgotPasswordBody = {
  email?: string;
};

const NEUTRAL_RESPONSE = {
  ok: true as const,
  message: PASSWORD_RESET_NEUTRAL_MESSAGE,
};

export async function POST(request: Request) {
  let email = "";

  try {
    const body = (await request.json()) as ForgotPasswordBody;
    email = typeof body.email === "string" ? body.email : "";
  } catch {
    return NextResponse.json(NEUTRAL_RESPONSE);
  }

  if (isSyntacticallyValidPasswordResetEmail(email)) {
    after(async () => {
      try {
        await requestPasswordResetByEmail(email);
      } catch {
        console.error("[password-reset] background request failed");
      }
    });
  }

  return NextResponse.json(NEUTRAL_RESPONSE);
}
