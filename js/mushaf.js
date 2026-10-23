// رسم صفحة المصحف بخط QCF4: كل كلمة حرف واحد في خط الصفحة.
// منطق الضبط (fit) منقول كما هو من /mushaf/ في تطبيق الحلقة.

const SRC_W = 1024, MAXK = 1.12;
let FONTMAP = null;
const fontLoaded = new Map();
const pageCache = new Map();

export async function loadFontMap() {
  if (!FONTMAP) FONTMAP = await (await fetch('fontmap.json')).json();
  return FONTMAP;
}

export function fontUrl(file) {
  return `fonts/v4/${file}${file === 'QCF4_QBSML' ? '' : '_W'}.woff2`;
}

export function loadFont(key) {
  if (!fontLoaded.has(key)) {
    const file = Object.keys(FONTMAP.fonts).find(n => FONTMAP.fonts[n] === key) || key;
    const ff = new FontFace(key, `url(${fontUrl(file)})`);
    fontLoaded.set(key, ff.load().then(f => { document.fonts.add(f); }).catch(() => {}));
  }
  return fontLoaded.get(key);
}

export async function ensureFontsFor(p) {
  await loadFontMap();
  const keys = (FONTMAP.pages[p] || []).slice();
  if (!keys.includes('bsml')) keys.push('bsml');
  await Promise.all(keys.map(loadFont));
}

export function loadPage(p) {
  if (!pageCache.has(p)) {
    pageCache.set(p, fetch(`data/${p}.json`).then(r => {
      if (!r.ok) throw new Error('page ' + p);
      return r.json();
    }).catch(e => { pageCache.delete(p); throw e; }));
  }
  return pageCache.get(p);
}

// نحمّل الصفحة اللي قبل واللي بعد في الخلفية عشان التقليب يبقى فوري
export function prefetch(p) {
  [p - 1, p + 1].forEach(q => { if (q >= 1 && q <= 604) { loadPage(q).catch(() => {}); ensureFontsFor(q).catch(() => {}); } });
}

/**
 * يرسم الصفحة p جوه sheet.
 * classFor(id) → اسم الكلاس الإضافي للكلمة (لون نوع الخطأ) أو ''.
 */
export async function renderPage(sheet, stage, p, classFor) {
  const rows = await loadPage(p);
  await ensureFontsFor(p);
  const lineRows = rows.filter(l => l.t !== 'h' && l.t !== 'b');
  sheet.innerHTML = rows.map(l =>
    l.t === 'h' ? '<div class="hdr"><span style="font-family:' + l.f + '">' + l.c + '</span></div>'
    : l.t === 'b' ? '<div class="bsm" style="font-family:' + l.f + '">' + l.c + '</div>'
    : '<div class="ln"><span class="seg" style="font-family:' + l.f + '" data-f="' + l.f + '" data-x0="' + l.x0 + '" data-x1="' + l.x1 + '">' + l.g + '</span></div>'
  ).join('');
  // آخر "كلمة" في كل آية هي علامة رقم الآية — مش بتتعلّم
  const last = {};
  lineRows.forEach(l => (l.w || []).forEach(w => { if (!(last[w.k] >= w.p)) last[w.k] = w.p; }));
  sheet.querySelectorAll('.seg').forEach((s, i) => { s._w = lineRows[i].w || []; s._last = last; s._cls = classFor; });
  await document.fonts.ready;
  fit(sheet, stage);
}

function setWords(s, loose) {
  s.innerHTML = s._w.map(w => {
    const id = w.k + ':' + w.p;
    if (s._last[w.k] === w.p) return '<span class="n">' + w.c + '</span>';
    const c = s._cls(id);
    return '<span class="w' + (c ? ' ' + c : '') + '" data-id="' + id + '">' + w.c + '</span>';
  }).join(loose ? ' ' : '');
  s._loose = loose;
}

// إعادة تلوين الكلمات بدون إعادة الرسم
export function repaint(sheet) {
  sheet.querySelectorAll('.w').forEach(el => {
    const s = el.closest('.seg');
    el.className = 'w' + (s && s._cls(el.dataset.id) ? ' ' + s._cls(el.dataset.id) : '');
  });
}

function fit(sheet, stage) {
  const pad = 8;
  const W = sheet.clientWidth - pad * 2;
  const lines = [...sheet.querySelectorAll('.ln')];
  if (!lines.length) return;
  const segs = [...sheet.querySelectorAll('.seg')];
  const BASE = 40;
  segs.forEach(s => { s.style.transform = 'none'; s.style.width = 'auto'; s.style.textAlign = 'right'; s.style.textAlignLast = 'auto'; setWords(s, false); s.style.fontSize = BASE + 'px'; });
  const natural = el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; };
  const boxOf = s => (s.dataset.x1 - s.dataset.x0) / SRC_W * W;
  const placed = segs.filter(s => s.dataset.x0 !== 'null');
  const nat = new Map(segs.map(s => [s, natural(s)]));
  const ratios = placed.map(s => boxOf(s) / nat.get(s)).sort((a, b) => a - b);
  let size = ratios.length ? Math.floor(BASE * ratios[Math.floor(ratios.length / 2)] * 10) / 10 : 20;
  const widest = Math.max(...segs.map(s => nat.get(s)));
  size = Math.min(size, Math.floor((BASE * W / widest) * 10) / 10);
  const bs = sheet.querySelector('.bsm');
  const apply = sz => {
    segs.forEach(s => {
      s.style.fontSize = sz + 'px';
      const w = nat.get(s) * sz / BASE;
      if (s.dataset.x0 === 'null') { s.style.right = 'auto'; s.style.left = '0'; s.style.transform = 'none'; return; }
      s.style.right = ((SRC_W - s.dataset.x1) / SRC_W * W) + 'px';
      const box = boxOf(s);
      let k = box / w;
      if (k <= MAXK) {
        setWords(s, false);
        s.style.width = 'auto'; s.style.textAlign = 'right'; s.style.textAlignLast = 'auto';
        k = Math.max(0.9, Math.min(MAXK, k));
      } else {
        setWords(s, true);
        const r2 = document.createRange(); r2.selectNodeContents(s);
        const wl = r2.getBoundingClientRect().width;
        k = Math.max(0.9, Math.min(MAXK, box / wl));
        s.style.width = (box / k) + 'px';
        s.style.textAlign = 'justify'; s.style.textAlignLast = 'justify';
      }
      if (w * k > W) k = W / w;
      s.style.transform = 'scaleX(' + k.toFixed(3) + ')';
    });
    if (bs) bs.style.fontSize = (sz * 0.95) + 'px';
    lines.forEach(l => { l.style.height = (sz * 2.0) + 'px'; });
  };
  apply(size);
  const avail = stage.clientHeight - 10;
  let guard = 0;
  while (sheet.scrollHeight > avail && size > 10 && guard++ < 25) {
    size = Math.floor(size * 0.97 * 10) / 10;
    apply(size);
  }
  if (sheet.scrollHeight < avail) {
    const extra = (avail - sheet.scrollHeight) / lines.length;
    lines.forEach(l => { l.style.height = (size * 2.0 + extra) + 'px'; });
    if (sheet.scrollHeight > avail) lines.forEach(l => { l.style.height = (size * 2.0) + 'px'; });
  }
}
