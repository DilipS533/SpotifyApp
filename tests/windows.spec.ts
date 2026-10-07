import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('Windows bridge displays real session contract, controls, app selection, and pinning', async ({ page }) => {
  let spotifyRequests = 0;
  page.on('request', request => { if (request.url().includes('api.spotify.com')) spotifyRequests++; });
  await page.addInitScript(() => {
    const listeners = new Set<(event: { data: unknown }) => void>();
    const calls: { command: string; args: Record<string, unknown> }[] = [];
    const state = {
      selected: '', topmost: false,
      sessions: [{ id: 'Music.App', name: 'Music.App' }, { id: 'Browser.App', name: 'Browser.App' }],
      playback: {
        item: { id: 'windows-track', uri: 'windows-track', name: 'From my computer', duration_ms: 180000, type: 'track', artists: [{ name: 'Local artist' }], album: { name: 'Local album', images: [] } },
        is_playing: true, progress_ms: 30000, shuffle_state: false, repeat_state: 'off',
        device: { id: 'Music.App', name: 'Music.App', volume_percent: null, supports_volume: false, is_restricted: false },
        actions: { disallows: { toggling_shuffle: true, toggling_repeat_context: true, toggling_repeat_track: true, seeking: false, skipping_prev: false, skipping_next: false, pausing: false, resuming: false } },
      },
    };
    Object.assign(window, { __GROOVE_DESKTOP__: true, desktopCalls: calls, desktopState: state });
    Object.assign(window, { chrome: { webview: {
      addEventListener: (_type: string, listener: (event: { data: unknown }) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: { data: unknown }) => void) => listeners.delete(listener),
      postMessage: (request: { id: string; command: string; args: Record<string, unknown> }) => {
        calls.push(request);
        if (request.command === 'pause') state.playback.is_playing = false;
        if (request.command === 'play') state.playback.is_playing = true;
        if (request.command === 'topmost') state.topmost = !!request.args.enabled;
        if (request.command === 'select') state.selected = String(request.args.source);
        if (request.command === 'seek') state.playback.progress_ms = Number(request.args.position);
        const reply = { id: request.id, ok: true, data: request.command === 'snapshot' ? structuredClone(state) : null };
        setTimeout(() => listeners.forEach(listener => listener({ data: reply })), 5);
      },
    } } });
  });
  await page.goto('/');
  await expect(page.locator('.app')).toHaveClass(/desktop-app/);

  await expect(page.getByRole('heading', { name: 'From my computer' })).toBeVisible();
  await expect(page.locator('.device-status')).toContainText('LIVE FROM WINDOWS');
  await expect(page.getByRole('button', { name: 'Connect Spotify', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Shuffle', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Repeat: off' })).toBeDisabled();
  await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Up next' })).toBeDisabled();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Next track' }).click();
  await page.getByRole('button', { name: 'Previous track' }).click();
  await page.getByRole('slider', { name: 'Seek playback' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => (window as unknown as { desktopCalls: { command: string }[] }).desktopCalls.some(c => c.command === 'seek'))).toBe(true);
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByLabel('Media app', { exact: true }).selectOption('Browser.App');
  await expect(page.getByLabel('Media app', { exact: true })).toHaveValue('Browser.App');
  await page.getByRole('switch', { name: 'Always on top' }).click();
  await expect(page.getByRole('switch', { name: 'Always on top' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await page.locator('.mode-switch').getByRole('button', { name: 'mini', exact: true }).click();
  await expect(page.locator('.device')).toHaveClass(/mode-mini/);
  await page.locator('.mode-switch').getByRole('button', { name: 'expanded', exact: true }).click();
  await expect(page.locator('.device')).toHaveClass(/mode-expanded/);
  const calls = await page.evaluate(() => (window as unknown as { desktopCalls: { command: string; args: Record<string, unknown> }[] }).desktopCalls);
  expect(calls.map(c => c.command)).toEqual(expect.arrayContaining(['snapshot', 'play', 'pause', 'next', 'previous', 'seek', 'select', 'topmost', 'windowMode']));
  expect(calls.find(c => c.command === 'next')?.args.source).toBe('Music.App');
  expect(spotifyRequests).toBe(0);
});

test('browser explains Windows requirements instead of faking access', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /No Premium\? Use Windows media/ }).click();
  await expect(page.getByRole('dialog')).toContainText('This browser preview cannot read');
  await expect(page.getByRole('dialog')).toContainText('Groove.exe');
  const downloadLink = page.getByRole('link', { name: 'Download Groove for Windows' });
  await expect(downloadLink).toHaveAttribute('href', '/downloads/Groove-Windows-x64.zip');
});

test('native virtual host opens a file rather than a directory', () => {
  const host = readFileSync('desktop/Groove.Windows/Program.cs', 'utf8');
  expect(host).not.toContain('WindowStyle = WindowStyle.None');
  expect(host).toContain('Width = 390; Height = 730; MinWidth = 340; MinHeight = 170');
  expect(host).toContain('Width = (mode == "expanded" ? 470 : 390) * scale');
  expect(host).not.toContain('SetWindowRgn');
  expect(host).toContain('view.Source = new Uri(Origin + "/index.html")');
  expect(host).not.toContain('view.Source = new Uri(Origin + "/")');
  expect(host).toContain('NavigationCompleted');
});

test('portable Windows package is served as a ZIP download', async ({ request }) => {
  const response = await request.get('/downloads/Groove-Windows-x64.zip', { headers: { Range: 'bytes=0-3' } });
  expect(response.status()).toBe(206);
  expect((await response.body()).subarray(0, 4).toString('hex')).toBe('504b0304');
});
