import type { Playback } from './spotify';
export interface DesktopSnapshot {
  playback: Playback | null;
  sessions: { id: string; name: string }[];
  selected: string;
  topmost: boolean;
}
interface NativeWebView {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}
declare global {
  interface Window { __GROOVE_DESKTOP__?: boolean; chrome?: { webview?: NativeWebView } }
}
export const isDesktop = () => window.__GROOVE_DESKTOP__ === true && !!window.chrome?.webview;
export type DesktopCommand = 'snapshot' | 'play' | 'pause' | 'next' | 'previous' | 'seek' | 'shuffle' | 'repeat' | 'select' | 'topmost' | 'windowMode' | 'windowMinimize' | 'windowClose' | 'drag';
export function desktopRequest<T = unknown>(command: DesktopCommand, args: Record<string, unknown> = {}): Promise<T> {
  const bridge = window.chrome?.webview;
  if (!isDesktop() || !bridge) return Promise.reject(new Error('Windows media access is only available in the Groove desktop app.'));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); bridge.removeEventListener('message', listener); };
    const listener = (event: MessageEvent) => {
      const reply = event.data;
      if (!reply || reply.id !== id) return;
      cleanup();
      if (reply.ok) resolve(reply.data as T);
      else reject(new Error(reply.error || 'The Windows media app did not accept this action.'));
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Windows media is not responding. Try again.')); }, 10000);
    bridge.addEventListener('message', listener);
    try { bridge.postMessage({ id, command, args }); } catch (e) { cleanup(); reject(e); }
  });
}
