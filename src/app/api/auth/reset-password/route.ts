import { NextResponse } from "next/server";
import {
  completePasswordResetByToken,
  PasswordResetError,
  passwordResetErrorResponse,
} from "@/services/PasswordResetService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ResetPasswordBody = {
  token?: string;
  password?: string;
  passwordConfirmation?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ResetPasswordBody;
    const token = typeof body.token === "string" ? body.token : "";
    const password = typeof body.password === "string" ? body.password : "";
    const passwordConfirmation =
      typeof body.passwordConfirmation === "string" ? body.passwordConfirmation : "";

    await completePasswordResetByToken({
      token,
      password,
      confirmation: passwordConfirmation,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PasswordResetError) {
      return NextResponse.json(passwordResetErrorResponse(error), { status: 400 });
    }

    return NextResponse.json(
      {
        ok: false,
        code: "invalid",
        error: "Ссылка недействительна.",
      },
      { status: 400 },
    );
  }
}
