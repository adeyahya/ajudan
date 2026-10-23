/** The desktop app's bridge (electron/preload.cjs); undefined in a normal browser. */
type AjudanBridge = {
  app: true;
  /** Show this business in the window, starting it if it isn't running. */
  openFolder: (dir: string) => Promise<boolean>;
  /** Stop a running business's worker and server; missing in older app builds. */
  stopFolder?: (dir: string) => Promise<boolean>;
  showHome: () => Promise<boolean>;
  /** The system folder dialog; missing in app builds from before it existed. */
  pickFolder?: () => Promise<string | null>;
};

declare global {
  interface Window {
    ajudan?: AjudanBridge;
  }
}

export const appBridge = () => (typeof window === "undefined" ? undefined : window.ajudan);
