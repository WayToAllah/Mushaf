// حفظ ملفات التلاوة على الجهاز (Cache API) عشان تشتغل بدون نت.
// بنحمّل بـ fetch عادي (CORS) ونشغّل من blob — لأن الردود "المقفولة" (opaque) المتصفح مش بيشغّلها من الكاش
// لما المشغّل يطلب جزء من الملف (Range).

const CACHE = 'mushaf-audio-v1';
export const supported = typeof caches !== 'undefined';
const inflight = new Map();
let okCount = 0, failStreak = 0;

// لو التحميل بيفشل كذا مرة ورا بعض والجهاز متصل ومفيش ولا ملف نجح، يبقى الموقع مش سامح بالتحميل (CORS)
export const blocked = () => okCount === 0 && failStreak >= 3;

export async function cachedBlob(url) {
  if (!supported) return null;
  try {
    const r = await (await caches.open(CACHE)).match(url);
    return r ? await r.blob() : null;
  } catch (_) { return null; }
}

export async function has(url) {
  if (!supported) return false;
  try { return !!(await (await caches.open(CACHE)).match(url)); } catch (_) { return false; }
}

// بيرجّع true لو الملف بقى محفوظ (أو كان محفوظ قبل كده)
export function save(url) {
  if (!supported || blocked()) return Promise.resolve(false);
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    const c = await caches.open(CACHE);
    if (await c.match(url)) return true;
    const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!r.ok) throw new Error('http ' + r.status);
    await c.put(url, r);
    okCount++; failStreak = 0;
    return true;
  })()
    .catch(e => { if (e instanceof TypeError && navigator.onLine) failStreak++; return false; })
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

// عدد الآيات المحفوظة لكل قارئ: { Husary_128kbps: 345, ... }
export async function counts() {
  if (!supported) return {};
  const out = {};
  try {
    for (const req of await (await caches.open(CACHE)).keys()) {
      const m = /\/data\/([^/]+)\/\d{6}\.mp3$/.exec(req.url);
      if (m) out[m[1]] = (out[m[1]] || 0) + 1;
    }
  } catch (_) {}
  return out;
}

export async function clear() {
  if (supported) await caches.delete(CACHE);
}
