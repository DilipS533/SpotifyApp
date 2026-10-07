import { useEffect, useState } from 'react';
export type Material = 'silver' | 'graphite' | 'cream' | 'glass';
export type Mode = 'mini' | 'normal' | 'expanded';
export interface Settings { material: Material; dark: boolean; intensity: number; speed: number; scale: number; remember: boolean; reduced: boolean; mode: Mode; position: { x: number; y: number } }
const defaults: Settings = { material: 'silver', dark: false, intensity: 1, speed: 1, scale: 1, remember: true, reduced: false, mode: 'normal', position: { x: 0, y: 0 } };
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => {
    try { const saved = JSON.parse(localStorage.getItem('groove.settings') || 'null'); return saved ? { ...defaults, ...saved, ...(!saved.remember ? { mode: 'normal', position: defaults.position } : {}) } : defaults; } catch { return defaults; }
  });
  useEffect(() => { localStorage.setItem('groove.settings', JSON.stringify({ ...settings, ...(!settings.remember ? { mode: 'normal', position: defaults.position } : {}) })); }, [settings]);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings(s => ({ ...s, [key]: value }));
  return { settings, update };
}
