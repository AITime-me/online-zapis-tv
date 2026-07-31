"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SCHEDULE_ZOOM_DEFAULT,
  clampScheduleZoom,
  stepScheduleZoom,
  touchDistance,
  zoomFromPinch,
} from "@/lib/schedule/schedule-zoom";

/**
 * Масштаб таблицы + pinch на scroll-контейнере.
 * Pinch: native `{ passive: false }` на touchmove, чтобы preventDefault работал.
 * Один палец / tap не перехватываются.
 */
export function useScheduleZoom(initialZoom = SCHEDULE_ZOOM_DEFAULT) {
  const [zoom, setZoomState] = useState(() => clampScheduleZoom(initialZoom));
  const zoomRef = useRef(zoom);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const pinchRef = useRef<{
    startDistance: number;
    startZoom: number;
  } | null>(null);

  const setZoom = useCallback((next: number) => {
    setZoomState(clampScheduleZoom(next));
  }, []);

  const zoomIn = useCallback(() => {
    setZoomState((current) => stepScheduleZoom(current, 1));
  }, []);

  const zoomOut = useCallback(() => {
    setZoomState((current) => stepScheduleZoom(current, -1));
  }, []);

  const resetZoom = useCallback(() => {
    setZoomState(SCHEDULE_ZOOM_DEFAULT);
  }, []);

  const scrollRef = useCallback((node: HTMLElement | null) => {
    setScrollEl(node);
  }, []);

  useEffect(() => {
    if (!scrollEl) {
      return;
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) {
        pinchRef.current = null;
        return;
      }
      const distance = touchDistance(event.touches[0], event.touches[1]);
      if (!(distance > 0)) {
        pinchRef.current = null;
        return;
      }
      pinchRef.current = {
        startDistance: distance,
        startZoom: zoomRef.current,
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const pinch = pinchRef.current;
      if (!pinch || event.touches.length !== 2) {
        return;
      }
      event.preventDefault();
      const distance = touchDistance(event.touches[0], event.touches[1]);
      setZoomState(
        zoomFromPinch(pinch.startZoom, pinch.startDistance, distance),
      );
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) {
        pinchRef.current = null;
      }
    };

    scrollEl.addEventListener("touchstart", onTouchStart, { passive: true });
    scrollEl.addEventListener("touchmove", onTouchMove, { passive: false });
    scrollEl.addEventListener("touchend", onTouchEnd, { passive: true });
    scrollEl.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      scrollEl.removeEventListener("touchstart", onTouchStart);
      scrollEl.removeEventListener("touchmove", onTouchMove);
      scrollEl.removeEventListener("touchend", onTouchEnd);
      scrollEl.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [scrollEl]);

  return {
    zoom,
    setZoom,
    zoomIn,
    zoomOut,
    resetZoom,
    scrollRef,
  };
}
