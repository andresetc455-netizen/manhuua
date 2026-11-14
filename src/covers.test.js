import { describe, it, expect } from 'vitest';
import { norm, similarity, score, pickCandidate, hueOf } from './covers.js';

describe('portadas: coincidencia de títulos', () => {
  it('normaliza acentos, paréntesis y signos', () => {
    expect(norm('El Rey del Último Piso (Manhwa)!')).toBe('el rey del ultimo piso');
  });
  it('títulos iguales o casi iguales puntúan alto', () => {
    expect(similarity('Solo Leveling', 'solo-leveling')).toBe(1);
    expect(similarity('Tower of God', 'Tower of God (2010)')).toBeGreaterThan(0.9);
  });
  it('títulos distintos puntúan bajo', () => {
    expect(similarity('Tower of God', 'The Breaker')).toBeLessThan(0.4);
  });
  it('usa el mejor de los títulos alternativos', () => {
    expect(score('Na Honjaman Level Up', { title: 'Solo Leveling', altTitles: ['Na Honjaman Level Up'] })).toBe(1);
  });
});

describe('portadas: elección sin repetir', () => {
  const cands = [
    { url: 'a', score: 0.95 },
    { url: 'b', score: 0.9 },
    { url: 'c', score: 0.5 },
  ];
  it('elige la mejor no usada', () => {
    expect(pickCandidate(cands).url).toBe('a');
    expect(pickCandidate(cands, new Set(['a'])).url).toBe('b');
  });
  it('no elige por debajo del umbral', () => {
    expect(pickCandidate(cands, new Set(['a', 'b']))).toBeNull();
  });
  it('color de respaldo estable', () => {
    expect(hueOf('Manhuua')).toBe(hueOf('Manhuua'));
  });
});
