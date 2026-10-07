# Groove for Windows 10 / 11

This native WPF + Microsoft Edge WebView2 shell runs the existing React player and reads `Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager`. It does not use Spotify's Web API, OAuth, or a subscription. Spotify Free can be displayed when its app publishes a Windows media session; app-specific restrictions still apply.

## Run the ready-made app

In the browser preview, click **No Premium? Use Windows media instead**, then **Download Groove for Windows**. Extract the complete ZIP and open `Groove.exe`. You do not need Node.js, the .NET SDK, Spotify credentials, or Premium. The .NET runtime is bundled. Microsoft Edge WebView2 Runtime must be installed (normally already present); the included `START-HERE.txt` links to the official installer.

The generated archive is `public/downloads/Groove-Windows-x64.zip`. It is ignored by Git, so it is available in this workspace preview but will not automatically travel with source-only commits. Run `desktop/build.ps1` to regenerate it. The package is unsigned and Windows may show a trust warning.

## Build on Windows

Requirements:
- Windows 10 version 1809 or later, or Windows 11 (x64).
- Node.js LTS: https://nodejs.org
- .NET 8 SDK: https://dotnet.microsoft.com/download/dotnet/8.0
- Microsoft Edge WebView2 Evergreen Runtime: https://developer.microsoft.com/microsoft-edge/webview2 (normally installed on Windows 11 and most Windows 10 PCs).

Download the repository. In PowerShell, from its root:

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\build.ps1
.\desktop\publish\Groove.exe
```

The build script installs JavaScript dependencies, builds the Vite app into `dist/`, and publishes a self-contained x64 Windows app into `desktop/publish/`. Keep the entire publish directory together; it can be zipped and copied to another Windows PC. This is an unsigned portable build, not a signed installer. Windows may show a trust warning for downloaded unsigned apps. No admin privileges are required by Groove.

Start listening in Spotify, Edge, Chrome, or another media app that appears in the Windows system media panel. Groove follows Windows' selected session automatically. In Settings → Windows media, select a specific app or enable **Always on top**. Drag the top grip to move the real desktop window. Mini/normal/expanded modes resize it. Closing Groove does not stop the source app.

## What Windows supports

- Title, artist, album and thumbnail when provided by the source app.
- Play/pause, next/previous, seek, shuffle and repeat **only when advertised by the source session**. A rejected command produces an error, never simulated success.
- Windows timeline metadata and local progress interpolation; snapshots every second, skipping hidden/minimized rendering.
- Multiple app session selection. Windows exposes application IDs rather than friendly names; the selector displays those IDs.
- Real always-on-top and native position persistence. Disable Remember player state to stop restoring native window position and pin preference.

Windows' global media interface does **not** expose an upcoming queue or application volume. Those controls are disabled; use the source application's queue and Windows volume mixer. Live streams can lack a seekable duration. DRM/apps may withhold artwork. Groove identifies published metadata, not arbitrary sound recognition. YouTube and other browser media may expose different controls than music apps.

## Isolation

Frontend assets are bundled into the application and served by WebView2's local virtual host `https://groove.local`. There is no HTTP listener or localhost server. Native messages are accepted only from this exact origin. The bridge exposes only a small command allowlist and rechecks capabilities, seek bounds and the target media session for every action. External HTTPS links open in the default browser; external pages cannot navigate inside the privileged WebView. Artwork is delivered as an in-memory data URL, limited to 8 MiB. Persistent preferences and WebView browser data live under `%LOCALAPPDATA%\Groove`.

## Verification

Browser contract tests use an isolated mock of the WebView message transport to exercise UI capability flags, commands, source selection, errors, and desktop modes. They do not pretend to verify the real Windows API. The native Windows project has been successfully cross-compiled and published from Linux using .NET 8, with the frontend assets and runtime included in the portable ZIP. Archive integrity and the download interface are checked. Actual media access and window dragging/pinning must still be tested on Windows; Linux cannot run WPF or Windows media sessions.

Manual Windows acceptance checks:
1. Run Groove with no music: the physical player remains visible with Nothing playing.
2. Start a song: verify real title/artist/artwork and gently rotating disc.
3. Pause from the source app: Groove stops rotating smoothly. Resume and skip externally: Groove updates.
4. Test previous/next and seek where supported; unsupported actions must remain disabled.
5. Open two source apps and verify automatic and explicit session selection.
6. Enable Always on top; move Groove, change size, close and reopen; verify remembered state.
7. Close the selected source app; Groove must show an idle/unavailable state rather than control another app unexpectedly.
