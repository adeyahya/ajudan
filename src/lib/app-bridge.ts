/** The desktop app's bridge (electron/preload.cjs); undefined in a normal browser. */
type AjudanBridge = {
  app: true;
  openFolder: (dir: string) => Promise<boolean>;
  showHome: () => Promise<boolean>;
};

declare global {
  interface Window {
    ajudan?: AjudanBridge;
  }
}

export const appBridge = () => (typeof window === "undefined" ? undefined : window.ajudan);
