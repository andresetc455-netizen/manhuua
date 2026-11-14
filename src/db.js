// Envoltorio mínimo de IndexedDB + suscripción a cambios.
import { useEffect, useState } from 'react';

let dbp;
export function openDb() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('manhuua', 2);
    r.onupgradeneeded = () => {
      const d = r.result, has = (n) => d.objectStoreNames.contains(n);
      if (!has('series')) d.createObjectStore('series', { keyPath: 'id' });
      if (!has('chapters')) d.createObjectStore('chapters', { keyPath: 'id' }).createIndex('seriesId', 'seriesId');
      if (!has('pages')) d.createObjectStore('pages'); // clave: [chapterId, índice] -> Blob
      if (!has('progress')) d.createObjectStore('progress', { keyPath: 'chapterId' }).createIndex('seriesId', 'seriesId');
      if (!has('translations')) d.createObjectStore('translations'); // clave: [chapterId, índice] -> {w, h, items}
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const os = async (name) => (await openDb()).transaction(name).objectStore(name);

export const get = async (s, k) => req((await os(s)).get(k));
export const getAll = async (s, range) => req((await os(s)).getAll(range));
export const byIndex = async (s, i, v) => req((await os(s)).index(i).getAll(v));
export const pageRange = (chapterId) => IDBKeyRange.bound([chapterId, 0], [chapterId, Infinity]);

const subs = new Set();
export const subscribe = (f) => (subs.add(f), () => subs.delete(f));

/** Escritura atómica sobre uno o varios stores. fn recibe {store: IDBObjectStore}. */
export async function write(stores, fn) {
  const t = (await openDb()).transaction(stores, 'readwrite');
  const o = Object.fromEntries([].concat(stores).map((n) => [n, t.objectStore(n)]));
  fn(o);
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = t.onabort = () => rej(t.error); });
  subs.forEach((f) => f());
}

/** Hook: re-ejecuta la consulta cuando cambia la base. */
export function useDb(fn, deps = []) {
  const [v, setV] = useState();
  useEffect(() => {
    let alive = true;
    const run = () => fn().then((r) => alive && setV(r));
    run();
    const un = subscribe(run);
    return () => { alive = false; un(); };
  }, deps); // eslint-disable-line
  return v;
}
