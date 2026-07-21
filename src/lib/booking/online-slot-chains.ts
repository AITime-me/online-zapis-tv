/**
 * Post-filter для публичных онлайн-слотов: достижимые старты по цепочке
 * онлайн-услуг мастера внутри свободных сегментов рабочего окна.
 *
 * Чистая логика без I/O — вызывается из BookingService.getAvailableTimeSlots.
 */

export type SlotChainTiming = {
  durationMinutes: number;
  breakAfterMinutes: number;
};

export type SlotChainWorkWindow = {
  /** Начало окна (минуты от полуночи студийного дня). */
  startMinutes: number;
  /** Последний допустимый старт включительно. */
  lastStartMinutes: number;
  /**
   * Жёсткий конец для endsAt процедуры (без break), если constrainProcedureEnd.
   * null — процедура может выходить за lastStart (официальные часы студии).
   */
  hardEndMinutes: number | null;
  constrainProcedureEnd: boolean;
};

export type SlotChainBlockingInterval = {
  /** Начало занятости (минуты). */
  startMinutes: number;
  /** Конец занятости inclusive-exclusive: свободно с этой минуты (уже с breakAfter). */
  endMinutes: number;
};

export type FilterSlotsByReachableChainsInput = {
  rawSlots: string[];
  slotStepMinutes: number;
  /** Начало сетки итерации (rangeStart), минуты от полуночи. */
  gridOriginMinutes: number;
  workWindows: SlotChainWorkWindow[];
  blockingIntervals: SlotChainBlockingInterval[];
  /**
   * Online timing-варианты мастера.
   * null или [] — безопасный fallback: вернуть rawSlots без фильтрации.
   */
  onlineTimings: SlotChainTiming[] | null;
};

const MINUTES_PER_DAY = 24 * 60;

export function isOnlineBookingSlotChainsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.ONLINE_BOOKING_SLOT_CHAINS_ENABLED === "true";
}

export function parseTimeToMinutes(time: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) {
    throw new Error(`Invalid time string: ${time}`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minutesToTime(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) {
    throw new Error(`Invalid minutes: ${totalMinutes}`);
  }
  const clamped = Math.min(Math.floor(totalMinutes), MINUTES_PER_DAY - 1);
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Первый узел сетки ≥ targetMinutes. */
export function firstGridStartOnOrAfter(
  targetMinutes: number,
  gridOriginMinutes: number,
  slotStepMinutes: number,
): number | null {
  if (slotStepMinutes <= 0) {
    return null;
  }
  if (targetMinutes <= gridOriginMinutes) {
    return gridOriginMinutes;
  }
  const delta = targetMinutes - gridOriginMinutes;
  const steps = Math.ceil(delta / slotStepMinutes);
  return gridOriginMinutes + steps * slotStepMinutes;
}

/**
 * Правая граница покрытия окна для merge (exclusive для constrained hardEnd,
 * inclusive lastStart для studio defaults — сосед с start==lastStart склеивается).
 */
export function workWindowCoverageEnd(window: SlotChainWorkWindow): number {
  if (window.constrainProcedureEnd && window.hardEndMinutes != null) {
    return window.hardEndMinutes;
  }
  return window.lastStartMinutes;
}

/**
 * Объединяет пересекающиеся и соприкасающиеся публичные окна в непрерывные.
 * Разрыв (например 12:00 и 13:00) сохраняет отдельные окна.
 */
export function normalizePublicWorkWindows(
  windows: SlotChainWorkWindow[],
): SlotChainWorkWindow[] {
  if (windows.length <= 1) {
    return windows.map((window) => ({ ...window }));
  }

  const sorted = [...windows].sort(
    (left, right) =>
      left.startMinutes - right.startMinutes ||
      workWindowCoverageEnd(left) - workWindowCoverageEnd(right),
  );

  const merged: SlotChainWorkWindow[] = [{ ...sorted[0]! }];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index]!;
    const last = merged[merged.length - 1]!;
    const lastCoverageEnd = workWindowCoverageEnd(last);

    // overlapping или adjacent (next.start <= prev.coverageEnd)
    if (current.startMinutes <= lastCoverageEnd) {
      const eitherUnconstrained =
        !last.constrainProcedureEnd || !current.constrainProcedureEnd;

      last.startMinutes = Math.min(last.startMinutes, current.startMinutes);
      last.lastStartMinutes = Math.max(
        last.lastStartMinutes,
        current.lastStartMinutes,
      );

      if (eitherUnconstrained) {
        last.constrainProcedureEnd = false;
        last.hardEndMinutes = null;
      } else {
        last.constrainProcedureEnd = true;
        last.hardEndMinutes = Math.max(
          last.hardEndMinutes ?? last.lastStartMinutes,
          current.hardEndMinutes ?? current.lastStartMinutes,
        );
      }
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

function mergeBlockingIntervals(
  intervals: SlotChainBlockingInterval[],
): SlotChainBlockingInterval[] {
  if (intervals.length === 0) {
    return [];
  }

  const sorted = [...intervals].sort(
    (left, right) =>
      left.startMinutes - right.startMinutes ||
      left.endMinutes - right.endMinutes,
  );

  const merged: SlotChainBlockingInterval[] = [{ ...sorted[0]! }];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index]!;
    const last = merged[merged.length - 1]!;
    if (current.startMinutes <= last.endMinutes) {
      last.endMinutes = Math.max(last.endMinutes, current.endMinutes);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

type FreeSegment = {
  leftMinutes: number;
  busyRightMinutes: number;
  isLeading: boolean;
};

function busyHorizonForWindow(window: SlotChainWorkWindow): number {
  if (window.constrainProcedureEnd && window.hardEndMinutes != null) {
    return window.hardEndMinutes;
  }
  return MINUTES_PER_DAY;
}

function splitFreeSegments(
  window: SlotChainWorkWindow,
  blockingIntervals: SlotChainBlockingInterval[],
): FreeSegment[] {
  const horizon = busyHorizonForWindow(window);
  if (horizon <= window.startMinutes) {
    return [];
  }

  const relevant = mergeBlockingIntervals(
    blockingIntervals.filter(
      (interval) =>
        interval.endMinutes > window.startMinutes &&
        interval.startMinutes < horizon,
    ),
  );

  const segments: FreeSegment[] = [];
  let cursor = window.startMinutes;

  for (const block of relevant) {
    if (block.endMinutes <= cursor) {
      continue;
    }
    if (block.startMinutes > cursor) {
      segments.push({
        leftMinutes: cursor,
        busyRightMinutes: Math.min(block.startMinutes, horizon),
        isLeading: cursor === window.startMinutes,
      });
    }
    cursor = Math.max(cursor, block.endMinutes);
  }

  if (cursor < horizon) {
    segments.push({
      leftMinutes: cursor,
      busyRightMinutes: horizon,
      isLeading: cursor === window.startMinutes,
    });
  }

  return segments;
}

function timingFitsFromStart(
  startMinutes: number,
  timing: SlotChainTiming,
  window: SlotChainWorkWindow,
  segmentBusyRight: number,
): { busyEndMinutes: number } | null {
  const duration = Math.max(0, timing.durationMinutes);
  const breakAfter = Math.max(0, timing.breakAfterMinutes);
  const procedureEnd = startMinutes + duration;
  const busyEnd = procedureEnd + breakAfter;

  if (window.constrainProcedureEnd) {
    const hardEnd = window.hardEndMinutes ?? window.lastStartMinutes;
    if (procedureEnd > hardEnd) {
      return null;
    }
  }

  if (busyEnd > segmentBusyRight) {
    return null;
  }

  return { busyEndMinutes: busyEnd };
}

export function computeReachableStartsInSegment(input: {
  segmentLeftMinutes: number;
  segmentBusyRightMinutes: number;
  window: SlotChainWorkWindow;
  slotStepMinutes: number;
  gridOriginMinutes: number;
  onlineTimings: SlotChainTiming[];
}): Set<number> {
  const {
    segmentLeftMinutes,
    segmentBusyRightMinutes,
    window,
    slotStepMinutes,
    gridOriginMinutes,
    onlineTimings,
  } = input;

  const reachable = new Set<number>();
  const first = firstGridStartOnOrAfter(
    segmentLeftMinutes,
    gridOriginMinutes,
    slotStepMinutes,
  );

  if (
    first == null ||
    first > window.lastStartMinutes ||
    first >= segmentBusyRightMinutes ||
    first < segmentLeftMinutes
  ) {
    return reachable;
  }

  const queue: number[] = [first];
  reachable.add(first);

  while (queue.length > 0) {
    const start = queue.shift()!;

    for (const timing of onlineTimings) {
      const fitted = timingFitsFromStart(
        start,
        timing,
        window,
        segmentBusyRightMinutes,
      );
      if (!fitted) {
        continue;
      }

      const next = firstGridStartOnOrAfter(
        fitted.busyEndMinutes,
        gridOriginMinutes,
        slotStepMinutes,
      );
      if (
        next == null ||
        next > window.lastStartMinutes ||
        next >= segmentBusyRightMinutes ||
        reachable.has(next)
      ) {
        continue;
      }

      reachable.add(next);
      queue.push(next);
    }
  }

  return reachable;
}

function slotBelongsToWindow(
  slotMinutes: number,
  window: SlotChainWorkWindow,
): boolean {
  return (
    slotMinutes >= window.startMinutes && slotMinutes <= window.lastStartMinutes
  );
}

function slotBelongsToSegment(
  slotMinutes: number,
  segment: FreeSegment,
): boolean {
  return (
    slotMinutes >= segment.leftMinutes &&
    slotMinutes < segment.busyRightMinutes
  );
}

/**
 * Оставляет из rawSlots только старты из ведущих сегментов (до первой блокировки)
 * и достижимые по цепочке старты в сегментах после блокировок.
 *
 * Перед разбиением окна нормализуются (merge overlapping/adjacent).
 */
export function filterSlotsByReachableChains(
  input: FilterSlotsByReachableChainsInput,
): string[] {
  const {
    rawSlots,
    slotStepMinutes,
    gridOriginMinutes,
    blockingIntervals,
    onlineTimings,
  } = input;

  if (onlineTimings == null || onlineTimings.length === 0) {
    return rawSlots;
  }

  if (rawSlots.length === 0 || input.workWindows.length === 0) {
    return rawSlots;
  }

  const workWindows = normalizePublicWorkWindows(input.workWindows);
  const allowed = new Set<string>();

  for (const window of workWindows) {
    const segments = splitFreeSegments(window, blockingIntervals);

    for (const segment of segments) {
      if (segment.isLeading) {
        for (const slot of rawSlots) {
          const minutes = parseTimeToMinutes(slot);
          if (
            slotBelongsToWindow(minutes, window) &&
            slotBelongsToSegment(minutes, segment)
          ) {
            allowed.add(slot);
          }
        }
        continue;
      }

      const reachable = computeReachableStartsInSegment({
        segmentLeftMinutes: segment.leftMinutes,
        segmentBusyRightMinutes: segment.busyRightMinutes,
        window,
        slotStepMinutes,
        gridOriginMinutes,
        onlineTimings,
      });

      for (const slot of rawSlots) {
        const minutes = parseTimeToMinutes(slot);
        if (
          slotBelongsToWindow(minutes, window) &&
          slotBelongsToSegment(minutes, segment) &&
          reachable.has(minutes)
        ) {
          allowed.add(slot);
        }
      }
    }
  }

  return rawSlots.filter((slot) => allowed.has(slot));
}

/**
 * Решает, грузить ли timings и что передать в filter.
 * Чистая оркестрация без БД — для runtime-тестов счётчика loader.
 *
 * - flag off → skipFilter, loader не вызывается
 * - preloaded !== undefined → использовать preloaded, loader не вызывать
 * - иначе → один вызов load()
 */
export async function resolveOnlineFillTimingsForRequest(input: {
  chainsEnabled: boolean;
  preloadedOnlineTimings?: SlotChainTiming[] | null;
  load: () => Promise<SlotChainTiming[] | null>;
}): Promise<
  | { mode: "skip_filter" }
  | { mode: "use_timings"; timings: SlotChainTiming[] | null }
> {
  if (!input.chainsEnabled) {
    return { mode: "skip_filter" };
  }

  if (input.preloadedOnlineTimings !== undefined) {
    return { mode: "use_timings", timings: input.preloadedOnlineTimings };
  }

  const timings = await input.load();
  return { mode: "use_timings", timings };
}
