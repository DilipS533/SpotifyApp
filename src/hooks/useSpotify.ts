import { useCallback, useEffect, useRef, useState } from 'react';
import { api, completeAuth, disconnect, progressAt, SpotifyError, storedTokens } from '../lib/spotify';
import type { Playback, Track } from '../lib/spotify';

export function useSpotify(enabled = true) {
  const [connected, setConnected] = useState(!!storedTokens());
  const [initializing, setInitializing] = useState(true);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [profile, setProfile] = useState<{ display_name: string; product?: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueError, setQueueError] = useState('');
  const [queueOpen, setQueueOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const synced = useRef(Date.now());
  const snapshot = useRef<Playback | null>(null);
  const alive = useRef(true);
  const pollBusy = useRef(false);
  const mutationBusy = useRef(false);
  const waitUntil = useRef(0);
  const queueTime = useRef(0);
  const queueBusy = useRef(false);
  const queueWanted = useRef(false);
  const sessionGeneration = useRef(0);
  const handleError = useCallback((e: unknown) => {
    const message = e instanceof Error ? e.message : 'Could not reach Spotify. Check your connection.';
    setError(message);
    if (e instanceof SpotifyError) {
      if (e.status === 401 || !storedTokens()) { disconnect(); setConnected(false); }
      if (e.status === 429) waitUntil.current = Date.now() + e.retryAfter;
    }
  }, []);
  useEffect(() => {
    if (!enabled) { setInitializing(false); return; }
    alive.current = true;
    completeAuth().then(() => { if (alive.current) setConnected(!!storedTokens()); }).catch(handleError).finally(() => { if (alive.current) setInitializing(false); });
    return () => { alive.current = false; };
  }, [handleError, enabled]);
  const fetchQueue = useCallback(async (force = false) => {
    if (queueBusy.current || (!force && Date.now() - queueTime.current < 20000)) return;
    queueBusy.current = true;
    queueTime.current = Date.now();
    try { const data = await api<{ queue: Track[] }>('/me/player/queue'); if (alive.current) { setQueue(data?.queue || []); setQueueError(''); } }
    catch (e) { if (alive.current) setQueueError(e instanceof Error ? e.message : 'Queue unavailable.'); if (e instanceof SpotifyError && e.status === 429) waitUntil.current = Date.now() + e.retryAfter; }
    finally { queueBusy.current = false; }
  }, []);
  const sync = useCallback(async () => {
    if (pollBusy.current || mutationBusy.current || Date.now() < waitUntil.current) return;
    pollBusy.current = true;
    const generation = sessionGeneration.current;
    try {
      const data = await api<Playback>('/me/player');
      if (!alive.current || generation !== sessionGeneration.current) return;
      const changed = data?.item?.uri !== snapshot.current?.item?.uri;
      synced.current = Date.now();
      snapshot.current = data;
      setPlayback(data);
      setProgress(progressAt(data, synced.current, Date.now()));
      setError('');
      if (queueWanted.current) void fetchQueue(changed);
    } catch (e) { if (alive.current) { handleError(e); waitUntil.current = Math.max(waitUntil.current, Date.now() + 10000); } }
    finally { pollBusy.current = false; }
  }, [handleError, fetchQueue]);
  useEffect(() => {
    if (!enabled || !connected || initializing) return;
    void api<{ display_name: string; product?: string }>('/me').then(data => { if (alive.current) setProfile(data); }).catch(() => {});
    void sync();
    const timer = window.setInterval(() => { if (!document.hidden) void sync(); }, 4000);
    const visibility = () => { if (!document.hidden) void sync(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', visibility);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('online', visibility); };
  }, [enabled, connected, initializing, sync]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) setProgress(progressAt(snapshot.current, synced.current, Date.now())); }, 200);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { queueWanted.current = queueOpen; if (queueOpen && connected) void fetchQueue(true); }, [queueOpen, connected, fetchQueue]);
  const command = useCallback(async (path: string, method = 'PUT', body?: unknown) => {
    if (mutationBusy.current) return;
    mutationBusy.current = true;
    setBusy(true);
    try { await api(path, method, body); setError(''); }
    catch (e) { handleError(e); return false; }
    finally { mutationBusy.current = false; setBusy(false); }
    await sync();
    return true;
  }, [sync, handleError]);
  const logout = () => { sessionGeneration.current += 1; disconnect(); setConnected(false); setPlayback(null); snapshot.current = null; setProgress(0); setProfile(null); setQueue([]); setError(''); };
  const restricted = !connected || busy || !playback?.device || playback.device.is_restricted;
  return { connected, initializing, playback, profile, progress, error, setError, busy, restricted, queue, queueError, queueOpen, setQueueOpen, command, logout, sync,
    toggle: () => command(`/me/player/${playback?.is_playing ? 'pause' : 'play'}`),
    previous: () => command('/me/player/previous', 'POST'),
    next: () => command('/me/player/next', 'POST'),
    seek: (ms: number) => command(`/me/player/seek?position_ms=${Math.round(ms)}`),
    volume: (value: number) => command(`/me/player/volume?volume_percent=${Math.round(value)}`),
    shuffle: () => command(`/me/player/shuffle?state=${!playback?.shuffle_state}`),
    repeat: () => command(`/me/player/repeat?state=${playback?.repeat_state === 'off' ? 'context' : playback?.repeat_state === 'context' ? 'track' : 'off'}`),
  };
}
