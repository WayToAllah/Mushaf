// نص الآيات (data/text.json) للبحث والمتشابهات: تحميل + تطبيع + بحث + مقارنة.
// كل صف: [سورة, آية, صفحة, "الكلمات بمسافات"] — ترتيب الكلمات = ترقيمها في المصحف (QCF4).

let P = null;
export function loadText() {
  if (!P) {
    P = fetch('data/text.json')
      .then(r => { if (!r.ok) throw new Error('text'); return r.json(); })
      .then(rows => {
        const by = new Map();
        const list = rows.map(([s, a, p, t]) => {
          const words = t.split(' ');
          const o = { s, a, p, key: s + ':' + a, words, n: words.map(w => norm(w)) };
          // نص متصل من غير مسافات («يا أيها» = «ياأيها»)، ومكان بداية كل كلمة فيه
          let off = 0;
          o.starts = o.n.map(w => { const x = off; off += w.length; return x; });
          o.flat = o.n.join('');
          by.set(o.key, o);
          return o;
        });
        list.forEach((o, i) => { o.next = list[i + 1] || null; });
        return { list, by };
      })
      .catch(e => { P = null; throw e; });
  }
  return P;
}

// التطبيع (لكل كلمة): من غير تشكيل ولا همزات ولا ألف، والتاء المربوطة هاء — عشان الرسم العثماني
// يطابق الإملائي: «الرحمن/الرحمان»، «السموات/السماوات»، «الصلاة/الصلوة»، «يؤوده/يئوده».
// strict: بيسيب الألف اللي في أول الكلمة — بيتستخدم في «كلمات كاملة» عشان «إله» ماتطلعش «له».
const MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u200B-\u200F\u2060\uFEFF]/g;
export function norm(s, strict = false) {
  return s.replace(MARKS, '')
    .replace(/[ٱأإآ]/g, 'ا')
    .replace(/ءا/g, 'ا')         // ءامنوا = آمنوا
    .replace(/واة/g, 'اة')       // الصلواة → الصلاة
    .replace(/ى(?=[^\s])/g, 'ا') // اشترىه → اشتراه
    .replace(/ى/g, 'ي')
    .replace(/[ؤئء]/g, '')
    .replace(/ة/g, 'ه')
    .replace(strict ? /(?!^)ا/g : /ا/g, '');
}
// «يا» و«ها» في المصحف ملزوقين في الكلمة اللي بعدهم («ياأيها»، «هاأنتم»)
const queryWords = q => q.replace(MARKS, '').trim().replace(/(^|\s)(يا|ها)\s+/g, '$1$2').split(/\s+/);
export const normQuery = q => queryWords(q).map(w => norm(w)).join('');

// البحث: كل مكان في المصحف فيه النص ده. بيرجّع [{ v: الآية, from, to }] (أرقام كلمات من ١)
// whole: الكلمات كاملة بس (عشان «إله» ماتطلعش جوه «الله»)
export function search(T, query, { whole = false, limit = 1000 } = {}) {
  const q = normQuery(query);
  const strictQ = queryWords(query).map(w => norm(w, true)).join('');
  const out = [];
  if (q.length < 2) return { q, hits: out, more: false };
  for (const v of T.list) {
    let i = v.flat.indexOf(q);
    while (i >= 0) {
      const end = i + q.length, from = wordAt(v, i), to = wordAt(v, end - 1);
      if (!whole || (v.starts[from] === i && v.starts[to] + v.n[to].length === end &&
          v.words.slice(from, to + 1).map(w => norm(w, true)).join('') === strictQ)) {
        out.push({ v, from: from + 1, to: to + 1 });
        if (out.length > limit) return { q, hits: out.slice(0, limit), more: true };
        i = v.flat.indexOf(q, v.starts[to] + v.n[to].length);
      } else i = v.flat.indexOf(q, i + 1);
    }
  }
  return { q, hits: out, more: false };
}
function wordAt(v, off) {
  let lo = 0, hi = v.starts.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (v.starts[m] <= off) lo = m; else hi = m - 1; }
  return lo;
}

// المقارنة: الكلمات اللي في b ومش في a (حسب أطول تسلسل مشترك) — دي اللي بتفرق بين المتشابهين
export function diffWords(a, b) {
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const same = new Set();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { same.add(j); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return b.map((_, j) => !same.has(j));
}
