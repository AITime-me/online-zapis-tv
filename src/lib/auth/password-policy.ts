export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const BLOCKED_PASSWORDS = new Set(["password123"]);

export function validatePasswordPolicy(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Пароль должен содержать не менее ${PASSWORD_MIN_LENGTH} символов.`;
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Пароль не должен превышать ${PASSWORD_MAX_LENGTH} символов.`;
  }

  if (!/[a-z]/.test(password)) {
    return "Пароль должен содержать хотя бы одну строчную букву.";
  }

  if (!/[A-Z]/.test(password)) {
    return "Пароль должен содержать хотя бы одну заглавную букву.";
  }

  if (!/\d/.test(password)) {
    return "Пароль должен содержать хотя бы одну цифру.";
  }

  if (BLOCKED_PASSWORDS.has(password)) {
    return "Этот пароль слишком простой и не может быть использован.";
  }

  return null;
}

export function assertPasswordPolicy(password: string): void {
  const error = validatePasswordPolicy(password);
  if (error) {
    throw new Error(error);
  }
}
