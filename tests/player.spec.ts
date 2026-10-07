import { test, expect } from '@playwright/test';

// These fixtures exist only in tests; the application never generates playback data.
const song = { id: 'test-track', uri: 'spotify:track:test-track', name: 'A very long song title that should never escape the little player or overlap controls', type: 'track', duration_ms: 210000, artists: [{ name: 'A very long artist name with another artist' }], album: { name: 'An album', images: [], release_date: '2024-01-01' } };
const initialPlayback = { item: song, is_playing: true, progress_ms: 45000, shuffle_state: false, repeat_state: 'off', device: { id: 'device', name: 'Test speakers', volume_percent: 60, is_restricted: false, supports_volume: true } };

test('disconnected player, setup, settings persistence, and responsive modes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Connect Spotify', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Connect Spotify', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect securely with Spotify' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Graphite', exact: true }).click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.getByRole('switch', { name: 'Reduced motion' }).click();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('.device')).toHaveClass(/material-graphite/);
  await expect(page.locator('.app')).toHaveClass(/dark/);
  await expect(page.locator('.app')).toHaveClass(/reduced-motion/);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const mode of ['mini', 'normal', 'expanded']) {
      await page.locator('.mode-switch').getByRole('button', { name: mode, exact: true }).click();
      await expect(page.locator('.device')).toHaveClass(new RegExp(`mode-${mode}`));
      await page.waitForTimeout(500);
      const box = await page.locator('.device').boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.locator('.mode-switch').getByRole('button', { name: 'normal', exact: true }).click();
  await page.screenshot({ path: 'test-results/player-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('real UI sends playback controls and follows external state changes', async ({ page }) => {
  const playback = structuredClone(initialPlayback);
  const actions: string[] = [];
  await page.addInitScript(() => sessionStorage.setItem('groove.spotify.session', JSON.stringify({ access_token: 'test-only-token', refresh_token: 'test-only-refresh', expires_at: Date.now() + 3600000, client_id: 'a'.repeat(32) })));
  await page.route('https://api.spotify.com/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      actions.push(url.pathname + url.search);
      if (url.pathname.endsWith('/pause')) playback.is_playing = false;
      if (url.pathname.endsWith('/play')) playback.is_playing = true;
      if (url.pathname.endsWith('/shuffle')) playback.shuffle_state = url.searchParams.get('state') === 'true';
      if (url.pathname.endsWith('/repeat')) playback.repeat_state = url.searchParams.get('state')!;
      if (url.pathname.endsWith('/volume')) playback.device.volume_percent = Number(url.searchParams.get('volume_percent'));
      if (url.pathname.endsWith('/seek')) playback.progress_ms = Number(url.searchParams.get('position_ms'));
      await route.fulfill({ status: 204 }); return;
    }
    const data = url.pathname.endsWith('/queue') ? { queue: [song, { ...song, name: 'Up next track', uri: 'spotify:track:next' }] } : url.pathname === '/v1/me' ? { display_name: 'Test listener', product: 'premium' } : playback;
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: song.name })).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Next track' }).click();
  await page.getByRole('button', { name: 'Previous track' }).click();
  await page.getByRole('button', { name: 'Shuffle', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Shuffle', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Repeat: off' }).click();
  await expect(page.getByRole('button', { name: 'Repeat: context' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('slider', { name: 'Seek playback' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => actions.some(a => a.includes('/seek?position_ms='))).toBe(true);
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unmute', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Unmute', exact: true }).click();
  await page.getByRole('button', { name: 'Up next' }).click();
  await expect(page.getByText('Up next track', { exact: true })).toBeVisible();
  playback.item.name = 'Changed outside Groove';
  playback.is_playing = false;
  await expect(page.getByRole('heading', { name: 'Changed outside Groove' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
  expect(actions).toContain('/v1/me/player/next');
  expect(actions).toContain('/v1/me/player/previous');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect Spotify', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem('groove.spotify.session'))).toBeNull();
});

test('PKCE authorization uses a challenge and state, never a client secret', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect Spotify', exact: true }).click();
  await page.getByLabel('SPOTIFY CLIENT ID').fill('a'.repeat(32));
  const requestPromise = page.waitForRequest('https://accounts.spotify.com/authorize?**');
  await page.route('https://accounts.spotify.com/authorize?**', route => route.fulfill({ body: 'Spotify authorization test boundary' }));
  await page.getByRole('button', { name: 'Connect securely with Spotify' }).click();
  const url = new URL((await requestPromise).url());
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('code_challenge')).toHaveLength(43);
  expect(url.searchParams.get('state')).toHaveLength(64);
  expect(url.searchParams.has('client_secret')).toBe(false);
});

test('OAuth rejects mismatched state without exchanging a code', async ({ page }) => {
  let exchanged = false;
  await page.addInitScript(() => sessionStorage.setItem('groove.oauth', JSON.stringify({ verifier: 'test', state: 'expected', id: 'a'.repeat(32), uri: location.origin + '/', created: Date.now() })));
  await page.route('https://accounts.spotify.com/api/token', route => { exchanged = true; return route.fulfill({ status: 400 }); });
  await page.goto('/?code=test-code&state=wrong');
  await expect(page.getByRole('status')).toContainText('Connection request expired');
  expect(exchanged).toBe(false);
  expect(page.url()).not.toContain('code=');
});
