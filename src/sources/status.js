// Normalización del estado de publicación de una obra (fuentes en español e inglés).
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const STATUS = [
  [/(en curso|en emisi[oó]n|emisi[oó]n|publicand|activo|ongoing|releasing|publishing)/i, 'En curso'],
  [/(finalizad|completad|complet[oa]|terminad|finished|completed|ended)/i, 'Finalizado'],
  [/(pausa|hiatus|on hold)/i, 'En pausa'],
  [/(cancelad|abandonad|cancel+ed|dropped)/i, 'Cancelado'],
];
export const normStatus = (s) => { const t = clean(s); if (!t) return null; for (const [re, v] of STATUS) if (re.test(t)) return v; return t.length <= 24 ? t : null; };
