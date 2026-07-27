import { expect, test, type APIRequestContext } from "@playwright/test";

const FORBIDDEN_MASTER_APPOINTMENT_KEYS = [
  "clientPhone",
  "phone",
  "comment",
  "email",
  "manageToken",
  "manageTokenHash",
  "clientId",
  "importantNote",
  "appliedPromotions",
] as const;

const FORBIDDEN_VIEW_ONLY_APPOINTMENT_KEYS = [
  ...FORBIDDEN_MASTER_APPOINTMENT_KEYS,
  "promotionLabels",
] as const;

const VIEW_TOKEN =
  process.env.SCHEDULE_VIEW_TOKEN ?? "tvoe-vremya-team-2026";

function collectAppointmentObjects(value: unknown, bucket: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectAppointmentObjects(item, bucket);
    }
    return bucket;
  }

  if (!value || typeof value !== "object") {
    return bucket;
  }

  const record = value as Record<string, unknown>;
  if (
    record.kind === "appointment" ||
    (typeof record.clientName === "string" &&
      typeof record.startsAt === "string" &&
      typeof record.statusCode === "string")
  ) {
    bucket.push(record);
  }

  for (const nested of Object.values(record)) {
    collectAppointmentObjects(nested, bucket);
  }

  return bucket;
}

function assertNoForbiddenMasterAppointmentKeys(payload: unknown) {
  const appointments = collectAppointmentObjects(payload);

  for (const appointment of appointments) {
    for (const key of FORBIDDEN_MASTER_APPOINTMENT_KEYS) {
      expect(appointment, `appointment ${appointment.id}`).not.toHaveProperty(key);
    }
  }
}

function assertNoForbiddenViewOnlyAppointmentKeys(payload: unknown) {
  const appointments = collectAppointmentObjects(payload);

  for (const appointment of appointments) {
    for (const key of FORBIDDEN_VIEW_ONLY_APPOINTMENT_KEYS) {
      expect(appointment, `appointment ${appointment.id}`).not.toHaveProperty(key);
    }
  }
}

function assertNoPiiInBody(text: string) {
  expect(text).not.toMatch(/\+7\d{10}/);
  expect(text.toLowerCase()).not.toContain("manageToken");
  expect(text.toLowerCase()).not.toContain("clientPhone");
}

async function loginWithCredentials(
  request: APIRequestContext,
  email: string,
  password = "password123",
) {
  const csrfResponse = await request.get("/api/auth/csrf");
  expect(csrfResponse.ok()).toBeTruthy();
  const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };

  const loginResponse = await request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken,
      email,
      password,
      callbackUrl: "/schedule",
      json: "true",
    },
  });

  expect(loginResponse.ok()).toBeTruthy();
}

async function getAuthedApiContext(
  request: APIRequestContext,
  email: string,
): Promise<APIRequestContext> {
  await loginWithCredentials(request, email);
  return request;
}

test.describe("Security Batch 1", () => {
  test("legacy booking month/cell endpoints are not public", async ({ request }) => {
    const monthResponse = await request.get("/api/booking/month?month=2026-07");
    expect([404, 405, 410]).toContain(monthResponse.status());
    assertNoPiiInBody(await monthResponse.text());

    const cellResponse = await request.get(
      "/api/booking/cell?masterId=test&date=2026-07-03",
    );
    expect([404, 405, 410]).toContain(cellResponse.status());
    assertNoPiiInBody(await cellResponse.text());
  });

  test("unauthenticated internal schedule APIs return 401 without PII", async ({
    request,
  }) => {
    const monthResponse = await request.get("/api/schedule/month?month=2026-07");
    expect(monthResponse.status()).toBe(401);
    assertNoPiiInBody(await monthResponse.text());

    const cellResponse = await request.get(
      "/api/schedule/cell?masterId=test&date=2026-07-03",
    );
    expect(cellResponse.status()).toBe(401);
    assertNoPiiInBody(await cellResponse.text());
  });

  test("MASTER schedule day JSON includes safe labels and excludes PII", async ({
    request,
  }) => {
    const api = await getAuthedApiContext(request, "master@example.local");
    const response = await api.get("/api/schedule/day?date=2026-07-03");
    expect(response.ok()).toBeTruthy();

    const payload = await response.json();
    expect(payload.ok).toBe(true);
    assertNoForbiddenMasterAppointmentKeys(payload);

    const appointments = collectAppointmentObjects(payload);
    for (const appointment of appointments) {
      if ("promotionLabels" in appointment) {
        expect(Array.isArray(appointment.promotionLabels)).toBe(true);
      }
      if ("masterNote" in appointment && appointment.masterNote != null) {
        expect(typeof appointment.masterNote).toBe("string");
      }
    }
  });

  test("MASTER sees masterNote for every appointment in the shared schedule table", async ({
    request,
  }) => {
    const studioMonth = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Yekaterinburg",
      year: "numeric",
      month: "2-digit",
    })
      .format(new Date())
      .slice(0, 7);

    const ownerApi = await getAuthedApiContext(request, "owner@example.local");
    const monthResponse = await ownerApi.get(
      `/api/schedule/month?month=${encodeURIComponent(studioMonth)}`,
    );
    expect(monthResponse.ok()).toBeTruthy();
    const monthPayload = (await monthResponse.json()) as {
      studioToday?: string;
      masters?: { id: string }[];
    };
    const dateKey = monthPayload.studioToday;
    expect(dateKey).toBeTruthy();
    expect((monthPayload.masters ?? []).length).toBeGreaterThanOrEqual(2);

    const ownerDay = await ownerApi.get(
      `/api/schedule/day?date=${encodeURIComponent(dateKey!)}`,
    );
    expect(ownerDay.ok()).toBeTruthy();
    const ownerPayload = (await ownerDay.json()) as {
      masters: {
        id: string;
        appointments: Record<string, unknown>[];
      }[];
    };

    const ownerNotesById = new Map<string, string>();
    for (const column of ownerPayload.masters ?? []) {
      for (const appointment of column.appointments ?? []) {
        if (
          typeof appointment.importantNote === "string" &&
          appointment.importantNote.trim()
        ) {
          ownerNotesById.set(String(appointment.id), appointment.importantNote);
          expect(appointment).toHaveProperty("clientPhone");
        }
      }
    }
    expect(
      ownerNotesById.size,
      "seed should include at least one importantNote today",
    ).toBeGreaterThan(0);

    const managerApi = await getAuthedApiContext(
      request,
      "manager@example.local",
    );
    const managerDay = await managerApi.get(
      `/api/schedule/day?date=${encodeURIComponent(dateKey!)}`,
    );
    expect(managerDay.ok()).toBeTruthy();
    const managerPayload = await managerDay.json();
    for (const [id, note] of ownerNotesById) {
      const row = collectAppointmentObjects(managerPayload).find(
        (item) => item.id === id,
      );
      expect(row?.importantNote).toBe(note);
    }

    async function assertMasterSeesAllNotes(email: string) {
      const api = await getAuthedApiContext(request, email);
      const day = await api.get(
        `/api/schedule/day?date=${encodeURIComponent(dateKey!)}`,
      );
      expect(day.ok()).toBeTruthy();
      const payload = await day.json();
      assertNoForbiddenMasterAppointmentKeys(payload);
      expect((payload.masters ?? []).length).toBe(
        (monthPayload.masters ?? []).length,
      );

      const byId = new Map(
        collectAppointmentObjects(payload).map((item) => [
          String(item.id),
          item,
        ]),
      );

      for (const [id, note] of ownerNotesById) {
        const row = byId.get(id);
        expect(row, `${email} missing appointment ${id}`).toBeTruthy();
        expect(row).toHaveProperty("masterNote", note);
        expect(row).not.toHaveProperty("clientPhone");
        expect(row).not.toHaveProperty("comment");
        expect(row).not.toHaveProperty("email");
        expect(row).not.toHaveProperty("importantNote");
      }

      const patchId = ownerNotesById.keys().next().value as string;
      const patchForbidden = await api.patch(`/api/appointments/${patchId}`, {
        data: { importantNote: "попытка изменить пометку" },
      });
      expect(patchForbidden.status()).toBe(403);
      assertNoPiiInBody(await patchForbidden.text());

      return collectAppointmentObjects(payload)
        .filter((item) => "masterNote" in item)
        .map((item) => [String(item.id), item.masterNote] as const)
        .sort(([left], [right]) => left.localeCompare(right));
    }

    const master1Notes = await assertMasterSeesAllNotes("master@example.local");
    const master2Notes = await assertMasterSeesAllNotes("master2@example.local");
    expect(master1Notes).toEqual(master2Notes);
  });

  test("MASTER cannot access schedule cell editor API", async ({ request }) => {
    const api = await getAuthedApiContext(request, "master@example.local");
    const response = await api.get(
      "/api/schedule/cell?masterId=test-master&date=2026-07-03",
    );
    expect(response.status()).toBe(403);
    assertNoPiiInBody(await response.text());
  });

  test("OWNER schedule cell editor remains available", async ({ request }) => {
    const api = await getAuthedApiContext(request, "owner@example.local");
    const monthResponse = await api.get("/api/schedule/month?month=2026-07");
    expect(monthResponse.ok()).toBeTruthy();

    const monthPayload = await monthResponse.json();
    const masterId = monthPayload.masters?.[0]?.id as string | undefined;
    expect(masterId).toBeTruthy();

    const cellResponse = await api.get(
      `/api/schedule/cell?masterId=${masterId}&date=2026-07-03`,
    );
    expect(cellResponse.ok()).toBeTruthy();

    const cellPayload = await cellResponse.json();
    expect(cellPayload.ok).toBe(true);
    expect(Array.isArray(cellPayload.appointments)).toBe(true);
  });

  test("view-only schedule month includes masterNote without phones or comments", async ({
    request,
  }) => {
    const response = await request.get(
      `/api/view/schedule/month?month=2026-07&token=${encodeURIComponent(VIEW_TOKEN)}`,
    );
    expect(response.ok()).toBeTruthy();
    const referrerPolicy = response.headers()["referrer-policy"];
    expect(referrerPolicy === "no-referrer" || referrerPolicy?.includes("no-referrer")).toBeTruthy();

    const payload = await response.json();
    expect(payload.ok).toBe(true);
    assertNoForbiddenViewOnlyAppointmentKeys(payload);

    const appointments = collectAppointmentObjects(payload);
    for (const appointment of appointments) {
      expect(appointment).toHaveProperty("masterNote");
      expect(appointment).not.toHaveProperty("importantNote");
      expect(appointment).not.toHaveProperty("promotionLabels");
      if (appointment.masterNote != null) {
        expect(typeof appointment.masterNote).toBe("string");
        expect(String(appointment.masterNote).trim().length).toBeGreaterThan(0);
      }
    }
  });

  test("OWNER appointment update rejects phone/email in master note", async ({
    request,
  }) => {
    const api = await getAuthedApiContext(request, "owner@example.local");
    const monthResponse = await api.get("/api/schedule/month?month=2026-07");
    expect(monthResponse.ok()).toBeTruthy();

    const monthPayload = await monthResponse.json();
    const masterId = monthPayload.masters?.[0]?.id as string | undefined;
    expect(masterId).toBeTruthy();

    const cellResponse = await api.get(
      `/api/schedule/cell?masterId=${masterId}&date=2026-07-03`,
    );
    expect(cellResponse.ok()).toBeTruthy();

    const cellPayload = await cellResponse.json();
    const appointmentId = cellPayload.appointments?.[0]?.id as string | undefined;
    if (!appointmentId) {
      test.skip();
      return;
    }

    const invalidResponse = await api.patch(`/api/appointments/${appointmentId}`, {
      data: {
        importantNote: "Связаться по +7 900 123-45-67",
      },
    });
    expect(invalidResponse.ok()).toBeFalsy();
    const invalidPayload = (await invalidResponse.json()) as { error?: string };
    expect(invalidPayload.error).toMatch(/телефон или email/i);

    const validResponse = await api.patch(`/api/appointments/${appointmentId}`, {
      data: {
        importantNote: "Индивидуальная скидка 15%, стоимость 3 500 ₽",
      },
    });
    expect(validResponse.ok()).toBeTruthy();
  });

  test("public booking request response is whitelist-only", async ({ request }) => {
    const response = await request.post("/api/booking/request", {
      headers: {
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: {
        clientName: "Security Test Client",
        clientPhone: "+70000000001",
        comment: "Security batch regression",
        masterId: null,
        type: "CONSULTATION_REQUEST",
        personalDataConsent: true,
        offerAcknowledgement: true,
      },
    });

    expect(response.ok()).toBeTruthy();
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(typeof payload.requestId).toBe("string");
    expect(typeof payload.message).toBe("string");
    expect(payload).not.toHaveProperty("client");
    expect(payload).not.toHaveProperty("clientId");
    expect(payload).not.toHaveProperty("possibleDuplicateClients");
    expect(payload).not.toHaveProperty("request");
  });

  test("health success response avoids infrastructure details", async ({ request }) => {
    const response = await request.get("/api/health");
    expect([200, 503]).toContain(response.status());

    const payload = (await response.json()) as Record<string, unknown>;
    if (response.status() === 200) {
      expect(payload.ok).toBe(true);
      expect(payload).not.toHaveProperty("database");
      expect(payload).not.toHaveProperty("timezone");
    } else {
      expect(payload.ok).toBe(false);
      expect(payload).not.toHaveProperty("error");
      expect(JSON.stringify(payload).toLowerCase()).not.toContain("database_url");
    }
  });
});
