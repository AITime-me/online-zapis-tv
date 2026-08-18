import "./wheel-ui.css";

import type { ReactNode } from "react";
import { WheelBrandHeader } from "./wheel-brand-header";
import { WheelProgress } from "./wheel-progress";
import type { WheelUiPhase } from "./wheel-ui.types";

type WheelLayoutProps = {
  title: string;
  subtitle?: string;
  phase: WheelUiPhase;
  children: ReactNode;
  footer?: ReactNode;
  showBrand?: boolean;
  compactHeader?: boolean;
};

export function WheelLayout({
  title,
  subtitle,
  phase,
  children,
  footer,
  showBrand = true,
  compactHeader = false,
}: WheelLayoutProps) {
  return (
    <div className="wheel-ui-root">
      <div className="wheel-layout relative mx-auto flex w-full max-w-[640px] flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden"
          aria-hidden
        >
          <div className="wheel-bg-glow" />
          <div className="wheel-bg-stars" />
          <div className="wheel-bg-arcs" />
        </div>

        <div className="wheel-layout-body relative z-10 flex flex-col">
          {showBrand ? (
            <WheelBrandHeader
              title={title}
              subtitle={subtitle}
              compact={compactHeader}
            />
          ) : null}
          <WheelProgress phase={phase} />
          <div className="wheel-layout-main wheel-step-enter flex flex-col">
            {children}
          </div>
          {footer ? (
            <div
              className="wheel-layout-footer relative z-10 mt-auto space-y-3 pt-5"
              data-testid="wheel-layout-footer"
            >
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
