export interface Track {
  id: string | null;
  uri: string;
  name: string;
  duration_ms: number;
  artists?: { name: string }[];
  album?: { name: string; images: { url: string }[]; release_date?: string };
  images?: { url: string }[];
  show?: { name: string };
  type: string;
  external_urls?: { spotify: string };
}
export interface Playback {
  item: Track | null;
  is_playing: boolean;
  progress_ms: number | null;
  shuffle_state: boolean;
  repeat_state: 'off' | 'context' | 'track';
  device: { id: string | null; name: string; volume_percent: number | null; is_restricted: boolean; supports_volume?: boolean } | null;
  actions?: { disallows?: Record<string, boolean> };
}
interface Tokens { access_token: string; refresh_token: string; expires_at: number; client_id: string }
const TOKEN_KEY = 'groove.spotify.session';
const CONFIG_KEY = 'groove.spotify.client';
const env = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;
export const redirectUri = () => env.VITE_SPOTIFY_REDIRECT_URI || `${location.origin}/`;
export const clientId = () => env.VITE_SPOTIFY_CLIENT_ID || localStorage.getItem(CONFIG_KEY) || '';
export function configureClient(value: string) { localStorage.setItem(CONFIG_KEY, value.trim()); }
export function storedTokens(): Tokens | null {
  try { return JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); } catch { return null; }
}
export function disconnect() { sessionStorage.removeItem(TOKEN_KEY); }
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join('');
export async function connect() {
  const id = clientId();
  if (!/^[a-f0-9]{32}$/i.test(id)) throw new Error('Add your Spotify app client ID to connect.');
  const uri = new URL(redirectUri());
  if (uri.protocol !== 'https:' && !['127.0.0.1', '[::1]'].includes(uri.hostname)) throw new Error('Spotify requires HTTPS or a 127.0.0.1 loopback callback.');
  const verifier = random();
  const state = random();
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  sessionStorage.setItem('groove.oauth', JSON.stringify({ verifier, state, id, uri: uri.href, created: Date.now() }));
  const params = new URLSearchParams({ client_id: id, response_type: 'code', redirect_uri: uri.href, state, code_challenge_method: 'S256', code_challenge: challenge, scope: 'user-read-private user-read-playback-state user-read-currently-playing user-modify-playback-state' });
  location.assign(`https://accounts.spotify.com/authorize?${params}`);
}
let callbackPromise: Promise<boolean> | null = null;
export function completeAuth() {
  if (callbackPromise) return callbackPromise;
  callbackPromise = (async () => {
    const params = new URLSearchParams(location.search);
    if (!params.has('code') && !params.has('error')) return false;
    const pending = JSON.parse(sessionStorage.getItem('groove.oauth') || 'null');
    history.replaceState({}, '', location.pathname);
    sessionStorage.removeItem('groove.oauth');
    if (!pending || pending.state !== params.get('state') || Date.now() - pending.created > 600000) throw new Error('Connection request expired. Please connect again.');
    if (params.has('error')) throw new Error('Spotify connection was cancelled. You can try again whenever you like.');
    await tokenRequest({ grant_type: 'authorization_code', code: params.get('code')!, redirect_uri: pending.uri, code_verifier: pending.verifier, client_id: pending.id }, pending.id);
    return true;
  })();
  return callbackPromise;
}
async function tokenRequest(params: Record<string, string>, id: string, oldRefresh?: string) {
  const response = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) disconnect();
    throw new SpotifyError('Spotify session expired. Please reconnect.', response.status);
  }
  const data = await response.json();
  const tokens: Tokens = { access_token: data.access_token, refresh_token: data.refresh_token || oldRefresh, expires_at: Date.now() + data.expires_in * 1000, client_id: id };
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  return tokens;
}
let refreshing: Promise<Tokens> | null = null;
async function accessToken(force = false) {
  const tokens = storedTokens();
  if (!tokens) throw new SpotifyError('Reconnect Spotify to continue.', 401);
  if (!force && tokens.expires_at > Date.now() + 60000) return tokens.access_token;
  if (!refreshing) refreshing = tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: tokens.client_id }, tokens.client_id, tokens.refresh_token).finally(() => { refreshing = null; });
  return (await refreshing).access_token;
}
export class SpotifyError extends Error {
  constructor(message: string, public status: number, public retryAfter = 0) { super(message); }
}
let blockedUntil = 0;
export async function api<T>(path: string, method = 'GET', body?: unknown, retried = false): Promise<T | null> {
  if (Date.now() < blockedUntil) throw new SpotifyError('Spotify needs a breather. Retrying shortly.', 429, blockedUntil - Date.now());
  const token = await accessToken();
  const response = await fetch(`https://api.spotify.com/v1${path}`, { method, signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (response.status === 401 && !retried) { await accessToken(true); return api<T>(path, method, body, true); }
  if (response.status === 204) return null;
  if (!response.ok) {
    if (response.status === 429) {
      const wait = Math.max(1000, Number(response.headers.get('Retry-After') || 30) * 1000);
      blockedUntil = Date.now() + wait;
      throw new SpotifyError('Spotify rate limit reached. Retrying shortly.', 429, wait);
    }
    const messages: Record<number, string> = { 401: 'Your session expired. Reconnect Spotify.', 403: 'Spotify does not allow this action. Check Premium, app access, and device restrictions.', 404: 'Open Spotify and play something on a device first.' };
    throw new SpotifyError(messages[response.status] || 'Spotify is temporarily unavailable. Please try again.', response.status);
  }
  return response.json() as Promise<T>;
}
export const artistName = (track: Track) => track.artists?.map(a => a.name).join(', ') || track.show?.name || 'Unknown artist';
export const artwork = (track: Track | null) => track?.album?.images?.[0]?.url || track?.images?.[0]?.url;
export function formatTime(ms: number) { const s = Math.floor(Math.max(0, ms) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
export function progressAt(playback: Playback | null, synced: number, now: number) {
  if (!playback?.item) return 0;
  return Math.min(playback.item.duration_ms, Math.max(0, (playback.progress_ms || 0) + (playback.is_playing ? Math.max(0, now - synced) : 0)));
}
