# Groove

A small, tactile Spotify remote built with React, TypeScript, and Vite. No demo tracks, client secret, backend, or separate user account. Spotify remains the playback device.

## Windows media mode — no Spotify Premium

A native Windows 10/11 version now reads the computer's system media sessions, keeping the same Groove interface. It supports media metadata, artwork, available playback controls, app selection, native dragging, and always-on-top without Spotify API credentials. See [desktop/README.md](desktop/README.md) for Windows build instructions and platform limitations. The browser preview cannot access other desktop apps.

## Run

```sh
bun install
bun run dev
```

The development command binds to `0.0.0.0` and respects `PORT` (default `5173`). Freebuff manages preview startup. Production command: `npm run build`, producing `dist/`.

## Connect Spotify

1. Create a Spotify app at https://developer.spotify.com/dashboard.
2. Register the **exact callback URL** shown by Groove's Connect Spotify dialog. HTTPS is required, except explicit `127.0.0.1` / `[::1]` loopback IPs. Spotify does not accept `localhost`.
3. Paste the public **Client ID** into the dialog. **Never enter a client secret.**
4. Allowlist your Spotify account in the app dashboard when using development mode, and sign in.
5. Open Spotify on a phone, computer, or speaker and start playback. Groove follows that device.

For shared deployments, configure `VITE_SPOTIFY_CLIENT_ID` and optionally `VITE_SPOTIFY_REDIRECT_URI` through Freebuff Settings → Environment before building. Both are public configuration, not secrets. Default callback is the current origin's `/`. Register the production callback separately from the preview URL.

Spotify Premium is required for playback controls. Spotify's 2026 development mode limits account eligibility, number of authorized users, and access to some endpoints; unsupported actions and unavailable queues are reported, never simulated. Expanded quota approval is needed for public-scale access.

## Features

- Official authorization-code PKCE flow with SHA-256, cryptographic state verification, automatic refresh, and no client secret.
- Real playback state polling every four seconds when visible; no hidden-tab polling. Progress interpolates locally between responses. Errors back off; rate limits respect `Retry-After`.
- Previous/next, play/pause, seeking, shuffle, three repeat modes, volume, mute; device and action restrictions disable controls.
- Album artwork on a layered physical CD, eased rotational inertia, artwork crossfades, fallback disc, reduced-motion support.
- Mini / normal / expanded modes, optional read-only Spotify queue, device metadata, four materials, light/dark workspace, scale and rotation settings.
- Desktop dragging, locally remembered preferences, fullscreen focus view, Space play/pause, focus-trapped settings and connection dialogs.

## Security and limitations

OAuth tokens and verifier are stored in **sessionStorage**, not URLs or logs. Tokens survive page refresh, but closing the tab ends the session, so returning later requires reconnecting. Only the public client ID and preferences persist in localStorage. Spotify handles passwords and permission consent.

This is a controller, not a browser audio renderer. Keep Spotify active on another device or in its web/desktop app. Volume can be unavailable for certain devices. Queue tracks are displayed, not falsely advertised as directly playable. External changes appear within the polling interval; Spotify Web API does not offer real-time playback events for remote devices.

A browser cannot provide an arbitrary always-on-top native window. Fullscreen is a real browser capability; dragging is within the webpage. The Spotify API, playback hook, preferences, and CD animation are separated from the UI so a future desktop wrapper can reuse them.

## Checks

```sh
bun run typecheck
bunx playwright install --with-deps chromium
PLAYWRIGHT_BASE_URL=https://YOUR_PREVIEW_URL bun run test
```

Browser tests cover disconnected states, setup, settings persistence, 320/390/1440px layouts, all sizes, API control contracts, external playback changes, and OAuth PKCE/state validation. Playback fixtures only exist in the test suite. Live Spotify verification requires an actual configured developer app and account.
