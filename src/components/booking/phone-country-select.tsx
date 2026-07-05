"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  getPhoneCountryOption,
  PHONE_COUNTRY_OPTIONS,
  type PhoneCountryCode,
} from "@/lib/phone/country-codes";

type PhoneCountrySelectProps = {
  value: PhoneCountryCode;
  onChange: (value: PhoneCountryCode) => void;
  borderColor: string;
  className?: string;
};

export function PhoneCountrySelect({
  value,
  onChange,
  borderColor,
  className,
}: PhoneCountrySelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = getPhoneCountryOption(value);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        className={className}
        style={{ borderColor }}
      >
        <span className="whitespace-nowrap">{selected.shortLabel}</span>
        <span aria-hidden className="ml-1 text-[#9ca3af]">
          ▾
        </span>
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 top-[calc(100%+4px)] z-20 max-h-64 min-w-[12rem] overflow-y-auto rounded-xl border bg-white py-1 shadow-lg"
          style={{ borderColor }}
        >
          {PHONE_COUNTRY_OPTIONS.map((option) => {
            const isSelected = option.id === value;
            return (
              <li key={option.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                  className="flex w-full px-3 py-2 text-left text-sm hover:bg-[#faf9f7]"
                  style={{
                    fontWeight: isSelected ? 600 : 400,
                  }}
                >
                  {option.listLabel}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
