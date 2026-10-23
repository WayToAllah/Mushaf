// التخزين الدائم على الجهاز.
// IndexedDB هو الأساس، ولو مش متاح (وضع خاص في بعض المتصفحات) بنرجع لـ localStorage.
// كل البيانات بتتحمّل في الذاكرة مرة واحدة عند الفتح، وكل تعديل بيتكتب فورًا.
//
// شكل سجل الخطأ (مخزن marks، المفتاح id):
//   { id:'سورة:آية:ترتيب_الكلمة', page, type, count, g:حرف_الكلمة, f:اسم_الخط, created, updated }
// أي خاصية جديدة لاحقًا (ملاحظة، تاريخ مراجعة...) تتضاف للسجل بدون تغيير في الإصدار.

const DB_NAME = 'mushaf-app';
const DB_VER = 1;
const LS_MARKS = 'mushaf-app:marks';
const LS_META = 'mushaf-app:meta';

export const marks = new Map();
export const meta = {};
let db = null;
let mode = 'idb';

const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

function openDB() {
  return new Promise((res, rej) => {
    if (!('indexedDB' in self)) return rej(new Error('no idb'));
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('marks')) d.createObjectStore('marks', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  });
}

export async function init() {
  try {
    db = await openDB();
    const t = db.transaction(['marks', 'meta']);
    const [all, keys, vals] = await Promise.all([
      req(t.objectStore('marks').getAll()),
      req(t.objectStore('meta').getAllKeys()),
      req(t.objectStore('meta').getAll()),
    ]);
    all.forEach(m => marks.set(m.id, m));
    keys.forEach((k, i) => { meta[k] = vals[i]; });
  } catch (e) {
    mode = 'ls';
    try {
      JSON.parse(localStorage.getItem(LS_MARKS) || '[]').forEach(m => marks.set(m.id, m));
      Object.assign(meta, JSON.parse(localStorage.getItem(LS_META) || '{}'));
    } catch (_) { /* لا شيء محفوظ */ }
  }
}

export const storageMode = () => mode;

function lsFlush() {
  try {
    localStorage.setItem(LS_MARKS, JSON.stringify([...marks.values()]));
    localStorage.setItem(LS_META, JSON.stringify(meta));
  } catch (_) { /* المساحة خلصت */ }
}

function write(store, fn) {
  if (mode === 'ls') { lsFlush(); return Promise.resolve(); }
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readwrite');
    fn(t.objectStore(store));
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export function putMark(m) {
  marks.set(m.id, m);
  return write('marks', s => s.put(m));
}

export function deleteMark(id) {
  marks.delete(id);
  return write('marks', s => s.delete(id));
}

export function clearMarks() {
  marks.clear();
  return write('marks', s => s.clear());
}

export function setMeta(k, v) {
  meta[k] = v;
  return write('meta', s => s.put(v, k));
}

export function marksOnPage(p) {
  const out = new Map();
  marks.forEach(m => { if (m.page === p) out.set(m.id, m); });
  return out;
}

// نطلب من المتصفح ميمسحش بيانات التطبيق لو المساحة قلّت.
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (_) {}
  return false;
}
export async function isPersisted() {
  try { return !!(navigator.storage && navigator.storage.persisted && await navigator.storage.persisted()); } catch (_) { return false; }
}

// ---- نسخة احتياطية ----
export function exportData() {
  return {
    app: 'mushaf-app', version: 1, exported: new Date().toISOString(),
    marks: [...marks.values()],
  };
}

// دمج: السجل الأحدث (updated) هو اللي بيكسب. بيرجّع عدد السجلات اللي اتضافت/اتحدثت.
export async function importData(obj) {
  if (!obj || obj.app !== 'mushaf-app' || !Array.isArray(obj.marks)) throw new Error('bad file');
  const valid = obj.marks.filter(m => m && typeof m.id === 'string' && /^\d+:\d+:\d+$/.test(m.id) && +m.page >= 1 && +m.page <= 604);
  const changed = valid.filter(m => { const cur = marks.get(m.id); return !cur || (m.updated || 0) > (cur.updated || 0); });
  changed.forEach(m => marks.set(m.id, m));
  if (mode === 'ls') lsFlush();
  else await write('marks', s => changed.forEach(m => s.put(m)));
  return changed.length;
}
