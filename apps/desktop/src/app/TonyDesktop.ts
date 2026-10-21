// Set only by the private macOS build; normal development keeps upstream defaults.
declare const __T3CODE_TONY_DESKTOP__: boolean | undefined;
export const isTonyDesktop =
  typeof __T3CODE_TONY_DESKTOP__ !== "undefined" && __T3CODE_TONY_DESKTOP__;
