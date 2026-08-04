import type { InputHTMLAttributes } from "react";

type WheelFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
};

export function WheelField({
  id,
  label,
  error,
  hint,
  className = "",
  ...props
}: WheelFieldProps) {
  const fieldId = id ?? props.name;
  const errorId = fieldId ? `${fieldId}-error` : undefined;
  const hintId = fieldId ? `${fieldId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={fieldId}
        className="text-sm font-medium text-[var(--wheel-ink)]"
      >
        {label}
      </label>
      <input
        id={fieldId}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={
          [error ? errorId : null, hint ? hintId : null]
            .filter(Boolean)
            .join(" ") || undefined
        }
        className={[
          "min-h-12 w-full rounded-2xl border bg-[var(--wheel-cream)] px-4 text-[16px] text-[var(--wheel-ink)]",
          "placeholder:text-[var(--wheel-muted)]",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wheel-gold)]",
          error
            ? "border-[var(--wheel-danger)]"
            : "border-[var(--wheel-beige)]/80",
          className,
        ].join(" ")}
        {...props}
      />
      {hint && !error ? (
        <p id={hintId} className="text-xs text-[var(--wheel-muted)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-sm text-[var(--wheel-danger)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
