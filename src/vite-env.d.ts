/// <reference types="vite/client" />

interface Window {
  __TAURI_INTERNALS__?: {
    invoke: (cmd: string, args?: unknown) => Promise<unknown>;
    transformCallback: (callback?: unknown, once?: boolean) => number;
    unregisterCallback: (id: number) => void;
    metadata: {
      currentWindow: { label: string };
      currentWebview: { label: string };
    };
    convertFileSrc: (path: string) => string;
  };
  __TAURI_EVENT_PLUGIN_INTERNALS__?: {
    unregisterListener: (event: string, eventId: number) => void;
  };
}
