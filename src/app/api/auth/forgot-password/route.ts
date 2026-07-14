import { NextResponse } from "next/server";
import { PASSWORD_RESET_NEUTRAL_MESSAGE } from "@/lib/auth/password-reset-messages";
import { requestPasswordResetByEmail } from "@/services/PasswordResetService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ForgotPasswordBody = {
  email?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ForgotPasswordBody;
    const email = typeof body.email === "string" ? body.email : "";

    await requestPasswordResetByEmail(email);

    return NextResponse.json({
      ok: true,
      message: PASSWORD_RESET_NEUTRAL_MESSAGE,
    });
  } catch {
    return NextResponse.json({
      ok: true,
      message: PASSWORD_RESET_NEUTRAL_MESSAGE,
    });
  }
}
