import { useEffect, useState } from 'react';

const KEY = 'manhuua.settings';
export const DEFAULTS = { mode: 'vertical', dir: 'ltr', fit: 'screen', theme: 'dark', gap: 0, maxWidth: 820, keepAwake: true, publicProxy: true, trProvider: 'mymemory', trFrom: 'en', trTo: 'es', trEmail: '', libreUrl: 'https://libretranslate.com', libreKey: '' };
const subs = new Set();

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return { ...DEFAULTS }; }
}
let current = loadSettings();

export function setSettings(patch) {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch {}
  subs.forEach((f) => f(current));
}

export function useSettings() {
  const [s, set] = useState(current);
  useEffect(() => (subs.add(set), () => subs.delete(set)), []);
  return [s, setSettings];
}
