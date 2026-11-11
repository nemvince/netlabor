declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement | string,
      url: string,
      options?: {
        shared?: boolean;
        credentials?: { username?: string; password?: string; target?: string };
        repeaterID?: string;
        wsProtocols?: string[];
      },
    );
    background: string;
    clipViewport: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    viewOnly: boolean;
    focusOnClick: boolean;
    showDotCursor: boolean;
    qualityLevel: number;
    compressionLevel: number;
    readonly capabilities: { power?: boolean; resize?: boolean };
    disconnect(): void;
    sendCredentials(credentials: { username?: string; password?: string; target?: string }): void;
    sendCtrlAltDel(): void;
    focus(): void;
    blur(): void;
    machineShutdown(): void;
    machineReboot(): void;
    machineReset(): void;
    clipboardPasteFrom(text: string): void;
  }
}
