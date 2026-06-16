import type { DesktopApi } from "../desktop/shared";

declare global {
  interface Window {
    api: DesktopApi;
  }
}

export {};
