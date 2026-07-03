function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return result === 0;
}

export function getScheduleViewToken(): string | null {
  const token = process.env.SCHEDULE_VIEW_TOKEN?.trim();
  return token || null;
}

export function isValidScheduleViewToken(candidate: string | null | undefined): boolean {
  const expected = getScheduleViewToken();
  if (!expected || !candidate) {
    return false;
  }

  return constantTimeEqual(expected, candidate);
}
