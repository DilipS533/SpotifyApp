import { useCallback, useEffect, useRef, useState } from 'react';
import { desktopRequest } from '../lib/desktop';
import type { DesktopCommand, DesktopSnapshot } from '../lib/desktop';
import { progressAt } from '../lib/spotify';

export function useWindowsMedia(enabled: boolean) {
  const [state, setState] = useState<DesktopSnapshot>({ playback: null, sessions: [], selected: '', topmost: false });
  const [connected, setConnected] = useState(false);
  const [initializing, setInitializing] = useState(enabled);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [queueOpen, setQueueOpen] = useState(false);
  const stateRef = useRef(state);
  const synced = useRef(Date.now());
  const inFlight = useRef(false);
  const actionBusy = useRef(false);
  const alive = useRef(false);
  const sync = useCallback(async () => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    try {
      const snapshot = await desktopRequest<DesktopSnapshot>('snapshot');
      if (!alive.current) return;
      stateRef.current = snapshot; synced.current = Date.now();
      setState(snapshot); setProgress(progressAt(snapshot.playback, synced.current, Date.now())); setConnected(true); setError('');
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Windows media is unavailable.'); }
    finally { inFlight.current = false; if (alive.current) setInitializing(false); }
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    alive.current = true;
    void sync();
    const timer = setInterval(() => { if (!document.hidden) void sync(); }, 1000);
    const progressTimer = setInterval(() => { if (!document.hidden) setProgress(progressAt(stateRef.current.playback, synced.current, Date.now())); }, 200);
    const wake = () => { if (!document.hidden) void sync(); };
    document.addEventListener('visibilitychange', wake);
    return () => { alive.current = false; clearInterval(timer); clearInterval(progressTimer); document.removeEventListener('visibilitychange', wake); };
  }, [enabled, sync]);
  const command = async (name: DesktopCommand, args: Record<string, unknown> = {}) => {
    if (actionBusy.current) return false;
    actionBusy.current = true; setBusy(true);
    try { await desktopRequest(name, { source: stateRef.current.playback?.device?.id, ...args }); setError(''); await sync(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'The media app declined this action.'); return false; }
    finally { actionBusy.current = false; setBusy(false); }
  };
  return {
    ...state, connected, initializing, playback: state.playback,
    profile: null, progress, error, setError, busy, restricted: !connected || busy || !state.playback?.device,
    queue: [], queueError: 'Windows does not expose an upcoming queue. Open the source app to manage it.', queueOpen, setQueueOpen,
    sync, logout: () => {},
    toggle: () => command(state.playback?.is_playing ? 'pause' : 'play'),
    previous: () => command('previous'), next: () => command('next'),
    seek: (position: number) => command('seek', { position }),
    volume: (_value: number) => { setError('Windows media sessions do not expose app volume. Use the Windows volume mixer.'); return Promise.resolve(false); },
    shuffle: () => command('shuffle', { enabled: !state.playback?.shuffle_state }),
    repeat: () => command('repeat', { mode: state.playback?.repeat_state === 'off' ? 'context' : state.playback?.repeat_state === 'context' ? 'track' : 'off' }),
    select: (source: string) => command('select', { source }),
    pin: (value: boolean) => command('topmost', { enabled: value }),
  };
}
