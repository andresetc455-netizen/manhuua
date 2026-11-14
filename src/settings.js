import { useEffect, useState } from 'react';

const KEY = 'manhuua.settings';
export const DEFAULTS = { mode: 'vertical', dir: 'ltr', fit: 'screen', theme: 'dark', gap: 0, maxWidth: 820, keepAwake: true, publicProxy: true, coverAuto: true, ytOpen: false, ytWidth: 420, ytCurrent: null, ytClientId: '', renderUrl: '', genUrl: 'https://api.openai.com/v1/images/generations', genModel: 'gpt-image-1', genSize: '1024x1536', genKey: '', trProvider: 'mymemory', trFrom: 'en', trTo: 'es', trEmail: '', libreUrl: 'https://libretranslate.com', libreKey: '' };
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
