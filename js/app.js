import { SURAS, PAGES, JUZ_NAME, JUZ_PAGE, JUZ_START, juzOfPage, suraPage, surasOnPage, suraName, pageOfAyah, AR, QUARTERS, QUARTER_FRAC, QUARTER_NAME, quarterPage, quartersOnPage, quarterAtPage } from './quran.js';
import * as S from './store.js';
import { renderPage, repaint, prefetch, loadFontMap, loadFont, fontUrl } from './mushaf.js';
import { loadText, search, normQuery, diffWords } from './text.js';
import { createPlayer, RECITERS, DEFAULT_RECITER, reciterName, audioUrl, nextAyah } from './audio.js';
import * as AC from './audio-cache.js';
import { initMigration } from './migrate.js';

// أنواع الأخطاء. لإضافة نوع جديد: سطر هنا + لون --t-<key> و .w.m-<key> في app.css.
const TYPES = [
  { key: 'hifz', name: 'حفظ', hint: 'نسي الكلمة أو بدّلها' },
  { key: 'tashkeel', name: 'تشكيل', hint: 'خطأ في الحركات' },
  { key: 'tajweed', name: 'تجويد', hint: 'مد، غنة، إخفاء…' },
  { key: 'waqf', name: 'تردد / وقف', hint: 'توقف أو تردد عند الكلمة' },
];
const TYPE = Object.fromEntries(TYPES.map(t => [t.key, t]));
const cssVar = k => `var(--t-${k})`;

const $ = s => document.querySelector(s);
const stage = $('#stage');
let page = 1;

// ---------------- الصفحة ----------------
const classFor = id => { const m = S.marks.get(id); return m ? 'm-' + m.type : ''; };
let renderTok = 0;

// peek: نظرة سريعة (من البحث أو المتشابهات) — موضع القراءة مايتحركش لحد ما تقلّب صفحة
async function show(p, dir = 0, focusId = null, peek = false) {
  p = Math.max(1, Math.min(PAGES, p | 0));
  page = p;
  S.setMeta('lastPage', p);
  if (!peek) trackPage(p);
  chrome();
  const tok = ++renderTok;
  stage.querySelectorAll('.sheet,.miss').forEach(e => e.remove());
  const sheet = document.createElement('div');
  const archStyle = (S.meta.rubStyle || 'arch') === 'arch';
  sheet.className = 'sheet';
  sheet.style.opacity = '0';
  if (dir) sheet.style.transform = `translateX(${dir > 0 ? -50 : 50}px)`;
  stage.prepend(sheet);
  try {
    const quarters = quartersOnPage(p).map(i => {
      const [s, a] = QUARTERS[i], h = Math.floor(i / 4) + 1, part = i % 4;
      return { key: s + ':' + a, h, part, hizb: part === 0, label: part === 0 ? AR(h) : QUARTER_FRAC[part],
        title: part === 0 ? 'بداية الحزب ' + AR(h) : QUARTER_NAME[part] + ' الحزب ' + AR(h) };
    });
    await renderPage(sheet, stage, p, classFor, { quarters, style: archStyle ? 'arch' : 'simple' });
    if (tok !== renderTok) return;
    requestAnimationFrame(() => { sheet.style.opacity = '1'; sheet.style.transform = ''; });
    [].concat(focusId || []).forEach(id => {
      const el = sheet.querySelector(`.w[data-id="${id}"]`);
      if (el) el.classList.add('pulse');
    });
    markPlaying(sheet);
  } catch (e) {
    if (tok !== renderTok) return;
    sheet.remove();
    const miss = document.createElement('div');
    miss.className = 'miss';
    miss.innerHTML = 'تعذّر تحميل صفحة ' + AR(p) + '.<br>لو انت بدون إنترنت: افتح الصفحة مرة وانت متصل، أو حمّل المصحف كامل من الإعدادات.<br><button>حاول تاني</button>';
    miss.querySelector('button').onclick = () => show(page);
    stage.prepend(miss);
  }
  prefetch(p);
}

function chrome() {
  const names = surasOnPage(page).map(suraName);
  $('#tSura').textContent = 'سورة ' + names.join(' · ');
  const q = quarterAtPage(page), part = q % 4;
  $('#tJuz').textContent = 'الجزء ' + JUZ_NAME[juzOfPage(page) - 1] + ' · ' + (part ? QUARTER_NAME[part] + ' ' : '') + 'الحزب ' + AR(Math.floor(q / 4) + 1);
  $('#pNum').textContent = AR(page);
  $('#trackName').textContent = activeTrack().name;
  $('#btnMarks').classList.toggle('marked', isBookmarked(page));
  $('#prev').style.visibility = page > 1 ? '' : 'hidden';
  $('#next').style.visibility = page < PAGES ? '' : 'hidden';
  counts();
}

function counts() {
  $('#errTotal').textContent = AR(S.marks.size);
  const by = {};
  S.marks.forEach(m => { if (m.page === page) by[m.type] = (by[m.type] || 0) + 1; });
  $('#pDots').innerHTML = TYPES.filter(t => by[t.key])
    .map(t => `<i style="--c:${cssVar(t.key)}" title="${t.name}">${AR(by[t.key])}</i>`).join('');
}

const go = (delta) => {
  const n = page + delta;
  if (n < 1) return toast('دي أول صفحة في المصحف');
  if (n > PAGES) return toast('دي آخر صفحة في المصحف');
  show(n, delta);
};
$('#prev').onclick = () => go(-1);
$('#next').onclick = () => go(1);
document.addEventListener('keydown', e => {
  if (document.querySelector('.panel.on, .bsheet.on') || e.target.matches('input,select')) return;
  if (e.key === 'ArrowLeft') go(1);
  if (e.key === 'ArrowRight') go(-1);
});

// السحب: يمين = الصفحة التالية (اتجاه تقليب المصحف)
(() => {
  let x0 = 0, y0 = 0, dx = 0, dy = 0, on = false;
  stage.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { on = false; return; }
    on = true; dx = dy = 0; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  stage.addEventListener('touchmove', e => {
    if (!on) return;
    dx = e.touches[0].clientX - x0; dy = e.touches[0].clientY - y0;
    if (Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 10) {
      stage.classList.add('drag');
      const s = stage.querySelector('.sheet');
      if (s) s.style.transform = `translateX(${dx * 0.35}px)`;
    }
  }, { passive: true });
  stage.addEventListener('touchend', () => {
    if (!on) return;
    on = false;
    stage.classList.remove('drag');
    const s = stage.querySelector('.sheet');
    if (s) s.style.transform = '';
    if (Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 55) go(dx > 0 ? 1 : -1);
  }, { passive: true });
})();

let resizeT;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => show(page), 200); });

// ---------------- تعليم الكلمات ----------------
let cur = null; // { id, el, glyph, font }

function parseId(id) { const [s, a, w] = id.split(':').map(Number); return { s, a, w }; }
function refText(id) { const { s, a, w } = parseId(id); return { ref: 'سورة ' + suraName(s) + ' · آية ' + AR(a), info: 'الكلمة ' + AR(w) + ' في الآية · صفحة ' + AR(pageOfAyah(s, a)) }; }

stage.addEventListener('click', e => {
  const el = e.target.closest('.w');
  if (!el) return;
  const id = el.dataset.id;
  const seg = el.closest('.seg');
  const ctx = { id, el, glyph: el.textContent, font: seg ? seg.dataset.f : '' };
  const existing = S.marks.get(id);
  if (!existing && S.meta.quick) { setMark(ctx, S.meta.defType || 'hifz'); return; }
  openWord(ctx);
});

function openWord(ctx) {
  cur = ctx;
  hideToast();
  document.querySelectorAll('.w.sel').forEach(x => x.classList.remove('sel'));
  ctx.el.classList.add('sel');
  const r = refText(ctx.id);
  $('#wsRef').textContent = r.ref;
  $('#wsInfo').textContent = r.info;
  const ww = $('#wsWord');
  ww.textContent = ctx.glyph;
  ww.style.fontFamily = ctx.font;
  paintSheet();
  paintStudy();
  openLayer('#wordSheet');
}

// ---------------- دراسة الآية: التفسير / معاني الكلمات / المتشابهات ----------------
// ملفات لكل صفحة: data/tafsir/mukhtasar/<p>.json و data/gharib/<p>.json — والمتشابهات ملف واحد صغير
const perPage = dir => {
  const cache = new Map();
  return p => {
    if (!cache.has(p)) cache.set(p, fetch(`data/${dir}/${p}.json`)
      .then(r => { if (!r.ok) throw 0; return r.json(); })
      .catch(e => { cache.delete(p); throw e; }));
    return cache.get(p);
  };
};
const tafsirOf = perPage('tafsir/mukhtasar');
const gharibOf = perPage('gharib');
let mutP = null;
const mutData = () => mutP || (mutP = fetch('data/mutashabihat.json')
  .then(r => { if (!r.ok) throw 0; return r.json(); })
  .catch(e => { mutP = null; throw e; }));

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ayahRef = (s, a) => 'سورة ' + suraName(s) + ' · آية ' + AR(a);
const NOT_LOADED = 'مش متحمّل على الجهاز — افتح النت مرة، أو حمّل المصحف كامل من الإعدادات.';
// التبويب المفتوح ('' = مقفول). اللي كان فاتح التفسير قبل كده يلاقيه مفتوح.
const studyTab = () => S.meta.study !== undefined ? S.meta.study : (S.meta.tafsirOpen ? 'tafsir' : '');
const countMut = groups => new Set(groups.flatMap(g => g.m.map(m => m.join(',')))).size;

let studyTok = 0;
async function paintStudy() {
  if (!cur) return;
  const tok = ++studyTok, k = studyTab(), { s, a, w } = parseId(cur.id), key = s + ':' + a, p = page;
  const live = () => tok === studyTok && cur;
  $('#wsStudy').classList.toggle('on', !!k);
  $('#wsTabs').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  $('#wsGharibN').textContent = ''; $('#wsMutN').textContent = '';
  gharibOf(p).then(g => { if (live() && g[key]) $('#wsGharibN').textContent = AR(g[key].length); }).catch(() => {});
  mutData().then(m => { if (live() && m[key]) $('#wsMutN').textContent = AR(countMut(m[key])); }).catch(() => {});
  if (!k) return;
  const body = $('#wsBody');
  body.innerHTML = '<p class="dim">جاري التحميل…</p>';
  let html;
  try {
    if (k === 'tafsir') html = studyTafsir((await tafsirOf(p))[key]);
    else if (k === 'gharib') html = studyGharib((await gharibOf(p))[key] || [], w);
    else html = studyMut((await mutData())[key] || [], await loadText());
  } catch (_) {
    html = `<p class="dim">${{ tafsir: 'التفسير', gharib: 'معاني الكلمات', mut: 'المتشابهات' }[k]} ${NOT_LOADED}</p>`;
  }
  if (!live()) return;
  body.innerHTML = html;
  body.scrollTop = 0;
}

function studyTafsir(t) {
  return `<p class="ws-tf-text">${t ? esc(t) : 'مفيش تفسير للآية دي.'}</p>
    <p class="ws-tf-src">المختصر في التفسير — مركز تفسير للدراسات القرآنية · المصدر: QuranEnc.com</p>`;
}

// السراج: [رقم_الكلمة, عدد_الكلمات, الكلمة, المعنى] — اللي بيغطي الكلمة الملموسة الأول
function studyGharib(list, w) {
  const covers = e => w >= e[0] && w < e[0] + e[1];
  const items = [...list.filter(covers), ...list.filter(e => !covers(e))];
  const body = items.length
    ? items.map(e => `<div class="gh${covers(e) ? ' cur' : ''}"><b>${esc(e[2])}</b>${esc(e[3])}</div>`).join('')
    : '<p class="dim">مفيش كلمات غريبة في الآية دي في «السراج».</p>';
  return body + '<p class="ws-tf-src">السراج في بيان غريب القرآن — د. محمد بن عبد العزيز الخضيري</p>';
}

// كلمات الآيات (ومعاها أول كام كلمة من الآية اللي بعدها لو المتشابه محتاج سياق)
function ayahSeq(T, keys, ctx) {
  const seq = [];
  keys.forEach(k => {
    const v = T.by.get(k);
    if (!v) return;
    v.words.forEach((t, i) => seq.push({ t, n: v.n[i] }));
    seq.push({ end: v.a });
  });
  const next = ctx && T.by.get(keys[keys.length - 1])?.next;
  if (next) next.words.slice(0, 6).forEach((t, i) => seq.push({ t, n: next.n[i], ctx: true }));
  if (next && next.words.length > 6) seq.push({ t: '…', ctx: true, skip: true });
  return seq;
}
function seqHtml(seq, flags) {
  let j = 0;
  return seq.map(x => {
    if (x.end) return `<span class="ctx">﴿${AR(x.end)}﴾</span>`;
    if (x.skip) return '<span class="ctx">…</span>';
    const t = esc(x.t), f = flags && flags[j++];
    return x.ctx ? `<span class="ctx">${f ? `<mark>${t}</mark>` : t}</span>` : (f ? `<mark>${t}</mark>` : t);
  }).join(' ');
}
const seqWords = seq => seq.filter(x => !x.end && !x.skip).map(x => x.n);

function studyMut(groups, T) {
  if (!groups.length) return '<p class="dim">مفيش متشابهات مسجّلة للآية دي.</p>' + MUT_SRC;
  return groups.map(g => {
    const src = ayahSeq(T, g.s, g.c), sw = seqWords(src);
    const first = T.by.get(g.s[0]), last = T.by.get(g.s[g.s.length - 1]);
    const head = `<div class="mut-src"><small>${g.s.length > 1 ? ayahRef(first.s, first.a) + ' – ' + AR(last.a) : 'الآية دي'}</small><div class="ayah">${seqHtml(src)}</div></div>`;
    return head + g.m.map(keys => {
      const v = T.by.get(keys[0]);
      if (!v) return '';
      const seq = ayahSeq(T, keys, g.c);
      const end = T.by.get(keys[keys.length - 1]);
      return `<button class="mut" data-p="${v.p}" data-id="${v.key}:1">
        <small><b>${ayahRef(v.s, v.a)}${keys.length > 1 ? ' – ' + AR(end.a) : ''}</b> · ص ${AR(v.p)}</small>
        <div class="ayah">${seqHtml(seq, diffWords(sw, seqWords(seq)))}</div></button>`;
    }).join('');
  }).join('') + '<p class="ws-tf-src">الكلمات الملوّنة هي اللي بتختلف عن الآية دي.</p>' + MUT_SRC;
}
const MUT_SRC = '<p class="ws-tf-src">بيانات المتشابهات: Quran Mutashabihat Data (وقار أحمد) — مبنية على عمل القارئ إدريس العاصم.</p>';

$('#wsTabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-k]');
  if (!b) return;
  S.setMeta('study', studyTab() === b.dataset.k ? '' : b.dataset.k);
  paintStudy();
});
// المتشابه: نروح نشوفه من غير ما الموضع الحالي يتحرك، ومعانا زرار رجوع
$('#wsBody').addEventListener('click', e => {
  const b = e.target.closest('.mut[data-p]');
  if (!b) return;
  const back = page;
  jumpTo(+b.dataset.p, b.dataset.id, true);
  if (back !== +b.dataset.p) toast('ص ' + AR(+b.dataset.p) + ' — ارجع لصفحة ' + AR(back), { label: 'رجوع', fn: () => show(back, 0, null) });
});

function paintSheet() {
  const m = S.marks.get(cur.id);
  $('#wsTypes').innerHTML = TYPES.map(t =>
    `<button data-t="${t.key}" class="${m && m.type === t.key ? 'on' : ''}" style="--c:${cssVar(t.key)}"><b>${t.name}</b><span>${t.hint}</span></button>`).join('');
  $('#wsExisting').classList.toggle('on', !!m);
  if (m) $('#wsCount').textContent = AR(m.count || 1);
}

$('#wsTypes').addEventListener('click', e => {
  const b = e.target.closest('button[data-t]');
  if (!b || !cur) return;
  setMark(cur, b.dataset.t);
  closeLayer();
});
$('#wsPlus').onclick = () => bump(+1);
$('#wsMinus').onclick = () => bump(-1);
$('#wsDelete').onclick = () => {
  const before = S.marks.get(cur.id);
  if (!before) return;
  commit(cur.id, null, before, 'اتشال الخطأ');
  closeLayer();
};

function bump(d) {
  const before = S.marks.get(cur.id);
  if (!before) return;
  const n = Math.max(1, (before.count || 1) + d);
  if (n === (before.count || 1)) return;
  commit(cur.id, { ...before, count: n, updated: Date.now() }, before, null);
  paintSheet();
}

function setMark(ctx, type) {
  const before = S.marks.get(ctx.id) || null;
  if (before && before.type === type) return;
  const now = Date.now();
  const rec = before
    ? { ...before, type, updated: now }
    : { id: ctx.id, page, type, count: 1, g: ctx.glyph, f: ctx.font, created: now, updated: now };
  commit(ctx.id, rec, before, (before ? 'اتغيّر إلى ' : 'اتعلّم خطأ ') + TYPE[type].name);
  if (!before) S.requestPersist();
}

let undoRec = null;
function commit(id, rec, before, msg) {
  (rec ? S.putMark(rec) : S.deleteMark(id)).catch(() => toast('مقدرتش أحفظ — مساحة الجهاز ممكن تكون خلصت'));
  refresh();
  if (msg) { undoRec = { id, before }; toast(msg, true); }
}

$('#snackUndo').onclick = () => {
  if (snackAct) { const f = snackAct.fn; snackAct = null; hideToast(); f(); return; }
  if (!undoRec) return;
  const { id, before } = undoRec;
  undoRec = null;
  (before ? S.putMark(before) : S.deleteMark(id));
  refresh();
  hideToast();
};

function refresh() {
  const sh = stage.querySelector('.sheet');
  if (sh) repaint(sh);
  counts();
}

// ---------------- إخفاء الأخطاء (للتسميع) ----------------
function applyHide() { document.body.classList.toggle('hide', !!S.meta.hide); }
$('#btnHide').onclick = () => {
  S.setMeta('hide', !S.meta.hide);
  applyHide();
  toast(S.meta.hide ? 'الأخطاء مخفية — سمّع من غير ما تشوفها' : 'الأخطاء ظاهرة');
};

// ---------------- الطبقات + زر الرجوع في أندرويد ----------------
const stack = [];
function openLayer(sel) {
  const el = $(sel);
  if (stack.includes(el)) return;
  stack.push(el);
  el.classList.add('on');
  if (el.classList.contains('bsheet')) $('#scrim').classList.add('on');
  history.pushState({ depth: stack.length }, '');
}
function hideTop() {
  const el = stack.pop();
  if (!el) return;
  el.classList.remove('on');
  if (el.classList.contains('bsheet')) {
    $('#scrim').classList.remove('on');
    document.querySelectorAll('.w.sel').forEach(x => x.classList.remove('sel'));
    cur = null;
  }
}
function closeLayer() { if (stack.length) history.back(); }
addEventListener('popstate', e => {
  const depth = (e.state && e.state.depth) || 0;
  while (stack.length > depth) hideTop();
});
$('#scrim').onclick = closeLayer;
document.querySelectorAll('[data-close]').forEach(b => b.onclick = closeLayer);
addEventListener('keydown', e => { if (e.key === 'Escape') closeLayer(); });

function jumpTo(p, focusId, peek = false) {
  // نقفل كل الطبقات الأول وبعدين ننتقل
  const n = stack.length;
  if (n) history.go(-n);
  show(p, 0, focusId, peek);
}

// ---------------- الفهرس ----------------
let idxTab = 'suras';
$('#btnIndex').onclick = () => { renderIndex(); openLayer('#panelIndex'); };
$('#btnTitle').onclick = $('#btnIndex').onclick;
$('#btnPage').onclick = () => { renderIndex(); openLayer('#panelIndex'); setTimeout(() => $('#jumpInput').focus(), 250); };
$('#idxTabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  idxTab = b.dataset.tab;
  $('#idxTabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  $('#suraSearch').hidden = idxTab !== 'suras';
  renderIndex();
});
$('#suraSearch').addEventListener('input', renderIndex);
const doJump = () => {
  const v = +String($('#jumpInput').value).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  if (v >= 1 && v <= PAGES) { $('#jumpInput').value = ''; jumpTo(v); }
  else toast('رقم الصفحة من ١ لـ ٦٠٤');
};
$('#jumpGo').onclick = doJump;
$('#jumpInput').addEventListener('keydown', e => { if (e.key === 'Enter') doJump(); });

function errorsBySura() {
  const by = {};
  S.marks.forEach(m => { const s = +m.id.split(':')[0]; by[s] = (by[s] || 0) + 1; });
  return by;
}

function renderIndex() {
  const list = $('#idxList');
  if (idxTab === 'suras') {
    const q = $('#suraSearch').value.trim().replace(/[أإآ]/g, 'ا');
    const by = errorsBySura();
    list.innerHTML = SURAS.map(([n, c], i) => ({ n, c, i: i + 1 }))
      .filter(x => !q || x.n.replace(/[أإآ]/g, 'ا').includes(q) || String(x.i) === q)
      .map(x => `<button class="row" data-p="${suraPage(x.i)}">
        <span class="num">${AR(x.i)}</span>
        <span class="mid"><b>${x.n}</b><span>${AR(x.c)} آية</span></span>
        ${by[x.i] ? `<span class="cnt">${AR(by[x.i])} خطأ</span>` : ''}
        <span class="pgno">ص ${AR(suraPage(x.i))}</span></button>`).join('')
      || '<div class="empty">مفيش سورة بالاسم ده</div>';
  } else if (idxTab === 'hizb') {
    let html = '';
    QUARTERS.forEach(([s, a], i) => {
      const h = Math.floor(i / 4) + 1, part = i % 4, p = quarterPage(i);
      if (part === 0) html += `<div class="grp">الحزب ${AR(h)}${h % 2 ? ' · الجزء ' + JUZ_NAME[(h - 1) / 2] : ''}</div>`;
      const next = QUARTERS[i + 1];
      const end = next ? quarterPage(i + 1) - (pageOfAyah(next[0], next[1]) === p ? 0 : 1) : PAGES;
      let n = 0; S.marks.forEach(m => { const [ms, ma] = m.id.split(':').map(Number); const k = ms * 1000 + ma; if (k >= s * 1000 + a && (!next || k < next[0] * 1000 + next[1])) n++; });
      html += `<button class="row" data-p="${p}">
        <span class="num rubnum">${part === 0 ? '۞' : QUARTER_FRAC[part]}</span>
        <span class="mid"><b>${part === 0 ? 'أول الحزب ' + AR(h) : QUARTER_NAME[part] + ' الحزب ' + AR(h)}</b><span>سورة ${suraName(s)} · آية ${AR(a)}</span></span>
        ${n ? `<span class="cnt">${AR(n)} خطأ</span>` : ''}
        <span class="pgno">ص ${AR(p)}</span></button>`;
    });
    list.innerHTML = html;
  } else {
    list.innerHTML = JUZ_PAGE.map((p, i) => {
      const end = i < 29 ? JUZ_PAGE[i + 1] - 1 : PAGES;
      let n = 0; S.marks.forEach(m => { if (m.page >= p && m.page <= end) n++; });
      return `<button class="row" data-p="${p}">
        <span class="num">${AR(i + 1)}</span>
        <span class="mid"><b>الجزء ${JUZ_NAME[i]}</b><span>يبدأ من سورة ${suraName(surasOnPage(p)[0])}</span></span>
        ${n ? `<span class="cnt">${AR(n)} خطأ</span>` : ''}
        <span class="pgno">ص ${AR(p)}</span></button>`;
    }).join('');
  }
}
$('#idxList').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) jumpTo(+b.dataset.p); });

// ---------------- قائمة الأخطاء ----------------
let errFilter = 'all';
$('#btnErrors').onclick = () => { renderErrors(); openLayer('#panelErrors'); };
$('#errFilter').addEventListener('click', e => {
  const b = e.target.closest('button[data-f]');
  if (!b) return;
  errFilter = b.dataset.f;
  renderErrors();
});
$('#errSort').addEventListener('change', () => { S.setMeta('sort', $('#errSort').value); renderErrors(); });

const cmpId = (a, b) => { const x = a.split(':').map(Number), y = b.split(':').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

async function renderErrors() {
  const all = [...S.marks.values()];
  const by = {}; all.forEach(m => { by[m.type] = (by[m.type] || 0) + 1; });
  $('#errStats').innerHTML = TYPES.map(t => `<div style="--c:${cssVar(t.key)}"><b>${AR(by[t.key] || 0)}</b><span>${t.name}</span></div>`).join('');
  $('#errFilter').innerHTML = [{ key: 'all', name: 'الكل' }, ...TYPES]
    .map(t => `<button data-f="${t.key}" class="${errFilter === t.key ? 'on' : ''}">${t.name}</button>`).join('');
  const sort = S.meta.sort || 'mushaf';
  $('#errSort').value = sort;

  let items = all.filter(m => errFilter === 'all' || m.type === errFilter);
  const list = $('#errList');
  if (!items.length) {
    list.innerHTML = `<div class="empty">${all.length ? 'مفيش أخطاء من النوع ده' : 'لسه مفيش أخطاء.<br>افتح أي صفحة والمس الكلمة اللي فيها خطأ.'}</div>`;
    return;
  }
  if (sort === 'count') items.sort((a, b) => (b.count || 1) - (a.count || 1) || cmpId(a.id, b.id));
  else if (sort === 'recent') items.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  else items.sort((a, b) => cmpId(a.id, b.id));

  const row = m => {
    const { s, a, w } = parseId(m.id);
    const t = TYPE[m.type] || TYPES[0];
    return `<button class="row" data-p="${m.page}" data-id="${m.id}">
      <span class="glyph" style="--c:${cssVar(m.type)};font-family:${m.f || 'inherit'}">${m.g || '•'}</span>
      <span class="mid"><b>${sort === 'mushaf' ? '' : 'سورة ' + suraName(s) + ' · '}آية ${AR(a)}</b>
        <span><i class="tag" style="--c:${cssVar(m.type)}">${t.name}</i>${(m.count || 1) > 1 ? ' · تكرر ' + AR(m.count) + ' مرات' : ''} · الكلمة ${AR(w)}</span></span>
      <span class="pgno">ص ${AR(m.page)}</span></button>`;
  };
  let html = '';
  if (sort === 'mushaf') {
    let lastS = 0;
    items.forEach(m => {
      const s = +m.id.split(':')[0];
      if (s !== lastS) { html += `<div class="grp">سورة ${suraName(s)}</div>`; lastS = s; }
      html += row(m);
    });
  } else html = items.map(row).join('');
  list.innerHTML = html;

  // نحمّل خطوط الكلمات عشان تتعرض بشكلها في المصحف
  try { await loadFontMap(); new Set(items.map(m => m.f).filter(Boolean)).forEach(f => loadFont(f)); } catch (_) {}
}
$('#errList').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) jumpTo(+b.dataset.p, b.dataset.id); });

// ---------------- البحث في القرآن ----------------
const SEARCH_HINT = '<div class="empty">اكتب كلمة أو جزء من آية.<br>البحث بيتجاهل التشكيل والهمزات والفرق بين الرسم العثماني والإملائي.</div>';
let searchT, searchRes = null, searchShown = 0;
$('#btnSearch').onclick = () => {
  openLayer('#panelSearch');
  setTimeout(() => $('#searchInput').focus(), 250);
  loadText().catch(() => {});
};
$('#searchInput').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(runSearch, 220); });
$('#searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(searchT); runSearch(); e.target.blur(); } });
$('#searchWhole').onchange = runSearch;

async function runSearch() {
  const q = $('#searchInput').value, list = $('#searchList');
  if (normQuery(q).length < 2) { searchRes = null; list.innerHTML = SEARCH_HINT; $('#searchCount').textContent = ''; return; }
  let T;
  try { T = await loadText(); }
  catch (_) { list.innerHTML = '<div class="empty">نص البحث ' + NOT_LOADED + '</div>'; return; }
  if ($('#searchInput').value !== q) return;
  searchRes = search(T, q, { whole: $('#searchWhole').checked });
  const n = searchRes.hits.length;
  $('#searchCount').textContent = n ? (searchRes.more ? 'أكتر من ' : '') + AR(n) + ' نتيجة' : '';
  list.innerHTML = n ? '' : '<div class="empty">مفيش نتايج</div>';
  searchShown = 0;
  list.scrollTop = 0;
  moreHits();
}
function moreHits() {
  const list = $('#searchList'), chunk = searchRes.hits.slice(searchShown, searchShown + 80);
  searchShown += chunk.length;
  list.querySelector('.more')?.remove();
  list.insertAdjacentHTML('beforeend', chunk.map(hitHtml).join('') +
    (searchShown < searchRes.hits.length ? '<button class="more">عرض المزيد</button>' : ''));
}
// النتيجة: الكلمات اللي اتلقت + ٧ كلمات قبلها وبعدها
function hitHtml({ v, from, to }) {
  const a = Math.max(1, from - 7), b = Math.min(v.words.length, to + 7), parts = [];
  for (let i = a; i <= b; i++) { const t = esc(v.words[i - 1]); parts.push(i >= from && i <= to ? `<mark>${t}</mark>` : t); }
  return `<button class="hit" data-p="${v.p}" data-key="${v.key}" data-from="${from}" data-to="${to}">
    <small><b>${ayahRef(v.s, v.a)}</b><span>ص ${AR(v.p)}</span></small>
    <span class="ayah">${a > 1 ? '… ' : ''}${parts.join(' ')}${b < v.words.length ? ' …' : ''}</span></button>`;
}
$('#searchList').addEventListener('click', e => {
  if (e.target.closest('.more')) return moreHits();
  const b = e.target.closest('.hit');
  if (!b) return;
  const ids = [];
  for (let i = +b.dataset.from; i <= +b.dataset.to; i++) ids.push(b.dataset.key + ':' + i);
  jumpTo(+b.dataset.p, ids, true);
});

// ---------------- المواضع والعلامات ----------------
// المواضع: كل واحد بيفتكر آخر صفحة (الحفظ، المراجعة، …) — الموضع الحالي بيمشي مع تقليب الصفحات.
// العلامات: صفحات محفوظة. الاتنين في meta وبيدخلوا في النسخة الاحتياطية.
function tracks() {
  if (!Array.isArray(S.meta.tracks) || !S.meta.tracks.length) {
    const p = S.meta.lastPage || 1, t = Date.now();
    S.setMeta('tracks', [{ id: 'hifz', name: 'الحفظ', page: p, t }, { id: 'murajaa', name: 'المراجعة', page: p, t }]);
    S.setMeta('activeTrack', 'hifz');
  }
  return S.meta.tracks;
}
const activeTrack = () => { const ts = tracks(); return ts.find(t => t.id === S.meta.activeTrack) || ts[0]; };
function trackPage(p) {
  const a = activeTrack();
  if (a.page !== p) S.setMeta('tracks', tracks().map(t => t.id === a.id ? { ...t, page: p, t: Date.now() } : t));
}
const bookmarks = () => Array.isArray(S.meta.bookmarks) ? S.meta.bookmarks : [];
const isBookmarked = p => bookmarks().some(b => b.p === p);
const pageWhere = p => 'سورة ' + suraName(surasOnPage(p)[0]) + ' · الجزء ' + JUZ_NAME[juzOfPage(p) - 1];
const PENCIL = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

$('#btnMarks').onclick = () => { renderMarks(); openLayer('#panelMarks'); };
function renderMarks() {
  const act = activeTrack();
  $('#trackList').innerHTML = tracks().map(t => `<div class="trow">
    <button class="row${t.id === act.id ? ' on' : ''}" data-track="${t.id}"><span class="dot"></span>
      <span class="mid"><b>${esc(t.name)}</b><span>${pageWhere(t.page)}</span></span>
      <span class="pgno">ص ${AR(t.page)}</span></button>
    <button class="ib" data-edit="${t.id}" aria-label="تعديل ${esc(t.name)}">${PENCIL}</button></div>`).join('');
  const marked = isBookmarked(page);
  $('#bmToggle').textContent = marked ? 'شيل علامة صفحة ' + AR(page) : 'علّم صفحة ' + AR(page);
  $('#bmToggle').classList.toggle('off', marked);
  const bms = [...bookmarks()].sort((a, b) => b.t - a.t);
  $('#bmList').innerHTML = bms.length ? bms.map(b => `<div class="trow">
    <button class="row" data-bm="${b.p}"><span class="num">${AR(b.p)}</span>
      <span class="mid"><b>${esc(b.name || pageWhere(b.p))}</b><span>${b.name ? pageWhere(b.p) + ' · ' : ''}${new Date(b.t).toLocaleDateString('ar-EG')}</span></span></button>
    <button class="ib" data-bmedit="${b.p}" aria-label="ملاحظة">${PENCIL}</button>
    <button class="ib" data-bmdel="${b.p}" aria-label="حذف">${CROSS}</button></div>`).join('')
    : '<div class="empty">لسه مفيش علامات.</div>';
}
$('#trackList').addEventListener('click', e => {
  const r = e.target.closest('[data-track]'), ed = e.target.closest('[data-edit]');
  if (r) {
    const t = tracks().find(x => x.id === r.dataset.track);
    S.setMeta('activeTrack', t.id);
    jumpTo(t.page);
    toast('موضع ' + t.name + ' · ص ' + AR(t.page));
  } else if (ed) {
    const ts = tracks(), t = ts.find(x => x.id === ed.dataset.edit);
    const name = prompt('اسم الموضع (امسح الاسم عشان تحذفه)', t.name);
    if (name === null) return;
    if (!name.trim()) {
      if (ts.length < 2) return toast('لازم يفضل موضع واحد على الأقل');
      if (!confirm('تحذف موضع «' + t.name + '»؟')) return;
      S.setMeta('tracks', ts.filter(x => x.id !== t.id));
      if (S.meta.activeTrack === t.id) S.setMeta('activeTrack', S.meta.tracks[0].id);
    } else S.setMeta('tracks', ts.map(x => x.id === t.id ? { ...x, name: name.trim().slice(0, 30), t: Date.now() } : x));
    renderMarks(); chrome();
  }
});
$('#trackAdd').onclick = () => {
  const name = prompt('اسم الموضع الجديد — هيبدأ من الصفحة دي', 'التلاوة');
  if (!name || !name.trim()) return;
  const t = { id: 't' + Date.now().toString(36), name: name.trim().slice(0, 30), page, t: Date.now() };
  S.setMeta('tracks', [...tracks(), t]);
  S.setMeta('activeTrack', t.id);
  renderMarks(); chrome();
};
$('#bmToggle').onclick = () => {
  const marked = isBookmarked(page);
  S.setMeta('bookmarks', marked ? bookmarks().filter(b => b.p !== page) : [...bookmarks(), { p: page, t: Date.now() }]);
  toast(marked ? 'اتشالت العلامة' : 'اتعلّمت صفحة ' + AR(page));
  renderMarks(); chrome();
};
$('#bmList').addEventListener('click', e => {
  const go = e.target.closest('[data-bm]'), ed = e.target.closest('[data-bmedit]'), del = e.target.closest('[data-bmdel]');
  if (go) return jumpTo(+go.dataset.bm);
  if (ed) {
    const b = bookmarks().find(x => x.p === +ed.dataset.bmedit);
    const name = prompt('ملاحظة للعلامة (اختياري)', b.name || '');
    if (name === null) return;
    S.setMeta('bookmarks', bookmarks().map(x => x === b ? { ...x, name: name.trim().slice(0, 60) || undefined, t: x.t } : x));
  }
  if (del) S.setMeta('bookmarks', bookmarks().filter(x => x.p !== +del.dataset.bmdel));
  renderMarks(); chrome();
});

// ---------------- التلاوة ----------------
// repeat: عدد مرات كل آية (0 = على طول)، cont: يكمّل للآية اللي بعدها
const REPEATS = [1, 2, 3, 5, 0];
const audioOpts = () => ({ reciter: S.meta.reciter || DEFAULT_RECITER, repeat: S.meta.repeat ?? 1, cont: S.meta.cont !== false, save: S.meta.saveAudio !== false });
let playKey = null, refitT;
const player = createPlayer({
  options: audioOpts,
  change: st => paintPlayer(st),
  error: () => toast(navigator.onLine ? 'مقدرتش أشغّل التلاوة — جرّب تاني' : 'الآية دي مش محفوظة على الجهاز ومفيش إنترنت — حمّلها من الإعدادات وانت متصل'),
});

function paintPlayer(st) {
  const bar = $('#player'), wasOpen = !bar.hidden;
  bar.hidden = !st;
  document.body.classList.toggle('playing', !!st);
  // المشغّل بياخد مساحة من الصفحة، فنعيد ضبط مقاسها لما يظهر أو يختفي
  if (wasOpen !== !!st) { clearTimeout(refitT); refitT = setTimeout(() => show(page), 30); }
  if (!st) { playKey = null; markPlaying(); return; }
  const { repeat, reciter } = audioOpts();
  bar.classList.toggle('on', st.playing);
  $('#plRef').textContent = suraName(st.s) + ' · ' + (st.bsm ? 'البسملة' : 'آية ' + AR(st.a));
  $('#plSub').textContent = reciterName(reciter) + (st.saved ? ' · محفوظة' : '') + (repeat !== 1 && !st.bsm ? ' · المرة ' + AR(st.rep) + (repeat ? ' من ' + AR(repeat) : '') : '');
  $('#plRepeat').textContent = repeat ? 'تكرار ×' + AR(repeat) : 'تكرار ∞';
  $('#plRepeat').classList.toggle('on', repeat !== 1);
  const key = st.s + ':' + st.a;
  if (key !== playKey) {
    const prevKey = playKey;
    playKey = key;
    followAyah(prevKey, st);
    markPlaying();
  }
}
// كلمات الآية اللي بتتقري بتتلوّن
function markPlaying(root = stage) {
  root.querySelectorAll('.w.playing').forEach(e => e.classList.remove('playing'));
  if (playKey) root.querySelectorAll(`.w[data-id^="${playKey}:"]`).forEach(e => e.classList.add('playing'));
}
// الصفحة بتتقلب مع التلاوة — بس لو كنت واقف على صفحة الآية اللي خلصت (مش لو بتتفرج على حتة تانية)
function followAyah(prevKey, st) {
  const p = pageOfAyah(st.s, st.a);
  if (p === page || !prevKey) return;
  const [ps, pa] = prevKey.split(':').map(Number);
  if (pageOfAyah(ps, pa) === page) show(p, p > page ? 1 : -1);
}

$('#wsListen').onclick = () => {
  if (!cur) return;
  const { s, a } = parseId(cur.id);
  closeLayer();
  player.playFrom(s, a);
};
$('#plPlay').onclick = () => player.toggle();
$('#plNext').onclick = () => player.next();
$('#plPrev').onclick = () => player.prev();
$('#plClose').onclick = () => player.stop();
$('#plRepeat').onclick = () => {
  const r = audioOpts().repeat;
  S.setMeta('repeat', REPEATS[(REPEATS.indexOf(r) + 1) % REPEATS.length]);
  paintPlayer(player.state());
  const n = audioOpts().repeat;
  toast(n === 1 ? 'من غير تكرار' : n ? 'كل آية هتتكرر ' + AR(n) + ' مرات' : 'الآية هتتكرر على طول لحد ما توقفها');
};
$('#plInfo').onclick = () => { const st = player.state(); if (st) jumpTo(pageOfAyah(st.s, st.a), st.s + ':' + st.a + ':1'); };
addEventListener('keydown', e => {
  if (e.key !== ' ' || !player.state() || e.target.matches('input,select,textarea,button')) return;
  e.preventDefault();
  player.toggle();
});
$('#setReciter').innerHTML = RECITERS.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
$('#setReciter').onchange = e => { S.setMeta('reciter', e.target.value); player.reload(); renderAudioDl(); };
$('#setCont').onchange = e => S.setMeta('cont', e.target.checked);
$('#setSaveAudio').onchange = e => S.setMeta('saveAudio', e.target.checked);

// ---------------- تحميل التلاوة للاستماع بدون نت ----------------
// قايمة آيات السورة أو الجزء (ومعاهم البسملة لو فيه أول سورة) → ملفات القارئ الحالي
function surahAyahs(s) { return Array.from({ length: SURAS[s - 1][1] }, (_, i) => [s, i + 1]); }
function juzAyahs(j) {
  const out = [], end = JUZ_START[j]; // أول آية في الجزء اللي بعده
  for (let x = JUZ_START[j - 1]; x && !(end && x[0] === end[0] && x[1] === end[1]); x = nextAyah(...x)) out.push(x);
  return out;
}
const ayahUrls = (list, rec) => {
  const urls = list.map(([s, a]) => audioUrl(rec, s, a));
  if (list.some(([s, a]) => a === 1 && s !== 1 && s !== 9)) urls.unshift(audioUrl(rec, 1, 1));
  return urls;
};

let audioDl = null; // { cancel, btn }
async function renderAudioDl() {
  const s = surasOnPage(page)[0], j = juzOfPage(page), rec = audioOpts().reciter;
  if (!audioDl) {
    $('#dlSura').textContent = 'حمّل سورة ' + suraName(s);
    $('#dlJuz').textContent = 'حمّل الجزء ' + JUZ_NAME[j - 1];
  }
  $('#dlSura').disabled = !!audioDl && audioDl.btn !== '#dlSura';
  $('#dlJuz').disabled = !!audioDl && audioDl.btn !== '#dlJuz';
  if (!AC.supported) { $('#audioInfo').textContent = 'المتصفح ده مش بيدعم حفظ التلاوة.'; return; }
  const n = (await AC.counts())[rec] || 0;
  let usage = '';
  try { const e = await navigator.storage.estimate(); usage = ' · مساحة التطبيق كله: ' + AR(Math.round(e.usage / 1048576)) + ' ميجا'; } catch (_) {}
  $('#audioInfo').textContent = (n ? 'محفوظ بصوت ' + reciterName(rec) + ': ' + AR(n) + ' ملف' : 'لسه مفيش تلاوات محفوظة بصوت ' + reciterName(rec)) + usage + '.';
}

async function downloadAudio(btn, list, label) {
  if (audioDl) { if (audioDl.btn === btn) audioDl.cancel = true; return; } // الضغط تاني = إلغاء
  if (!AC.supported) return toast('المتصفح ده مش بيدعم حفظ التلاوة');
  const urls = ayahUrls(list, audioOpts().reciter), bar = $('#adlProg');
  audioDl = { btn, cancel: false };
  bar.hidden = false;
  renderAudioDl();
  let done = 0, ok = 0, i = 0;
  const step = () => {
    done++;
    bar.firstElementChild.style.width = (done / urls.length * 100).toFixed(1) + '%';
    $(btn).textContent = 'جاري التحميل ' + AR(Math.round(done / urls.length * 100)) + '٪ — المس للإلغاء';
  };
  const worker = async () => {
    while (i < urls.length && !audioDl.cancel && !AC.blocked()) { const u = urls[i++]; if (await AC.save(u)) ok++; step(); }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const cancelled = audioDl.cancel;
  audioDl = null;
  bar.hidden = true;
  if (AC.blocked()) toast('موقع التلاوة مش سامح بالتحميل على الجهاز — التلاوة هتشتغل بالإنترنت بس');
  else if (cancelled) toast('اتلغى التحميل — اللي اتحمّل (' + AR(ok) + ' ملف) فضل محفوظ');
  else if (ok < urls.length) toast('اتحمّل ' + AR(ok) + ' من ' + AR(urls.length) + ' — اتأكد من النت وجرّب تاني');
  else { toast('خلص تحميل ' + label + ' ✓ — بقت تشتغل بدون نت'); S.requestPersist(); }
  renderAudioDl();
}
$('#dlSura').onclick = () => { const s = surasOnPage(page)[0]; downloadAudio('#dlSura', surahAyahs(s), 'سورة ' + suraName(s)); };
$('#dlJuz').onclick = () => { const j = juzOfPage(page); downloadAudio('#dlJuz', juzAyahs(j), 'الجزء ' + JUZ_NAME[j - 1]); };
$('#audioClear').onclick = async () => {
  if (audioDl) return toast('استنى التحميل يخلص أو الغيه الأول');
  if (!confirm('تمسح كل التلاوات المحفوظة على الجهاز (لكل القرّاء)؟')) return;
  await AC.clear();
  toast('اتمسحت التلاوات المحفوظة');
  renderAudioDl();
};

// ---------------- المظهر (الوضع الليلي) ----------------
// theme: auto (حسب الجهاز) / light / dark — بيتنسخ في localStorage عشان سكريبت الـ head يطبّقه قبل أول رسم
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = S.meta.theme || 'auto', root = document.documentElement;
  if (t === 'auto') delete root.dataset.theme; else root.dataset.theme = t;
  try { localStorage.setItem('mushaf-theme', t); } catch (_) {}
  const dark = t === 'dark' || (t === 'auto' && darkMQ.matches);
  document.querySelector('meta[name="theme-color"]').content = dark ? '#15130f' : '#fff9f1';
  $('#setTheme').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === t));
}
if (darkMQ.addEventListener) darkMQ.addEventListener('change', applyTheme);
$('#setTheme').addEventListener('click', e => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  S.setMeta('theme', b.dataset.v);
  applyTheme();
});

// ---------------- الإعدادات ----------------
$('#btnSettings').onclick = () => { renderSettings(); openLayer('#panelSettings'); };
$('#setDefault').innerHTML = TYPES.map(t => `<option value="${t.key}">${t.name}</option>`).join('');
$('#setQuick').onchange = e => S.setMeta('quick', e.target.checked);
$('#setDefault').onchange = e => S.setMeta('defType', e.target.value);
$('#setRub').onchange = e => { S.setMeta('rubStyle', e.target.value); show(page); };

async function renderSettings() {
  $('#setQuick').checked = !!S.meta.quick;
  $('#setDefault').value = S.meta.defType || 'hifz';
  $('#setRub').value = S.meta.rubStyle || 'arch';
  $('#setReciter').value = audioOpts().reciter;
  $('#setCont').checked = audioOpts().cont;
  $('#setSaveAudio').checked = audioOpts().save;
  renderAudioDl();
  const persisted = await S.isPersisted();
  const n = S.marks.size;
  const last = S.meta.lastBackup ? new Date(S.meta.lastBackup).toLocaleDateString('ar-EG') : null;
  $('#persistInfo').innerHTML =
    `محفوظ على الجهاز: <b>${AR(n)}</b> خطأ` +
    (S.storageMode() === 'ls' ? ' (تخزين احتياطي — المتصفح ده مش بيدعم IndexedDB)' : '') + '.<br>' +
    (persisted ? 'المتصفح موافق على الحفظ الدائم ✓' : 'المتصفح لسه ماأكدش الحفظ الدائم — تثبيت التطبيق على الشاشة الرئيسية بيساعد.') +
    (last ? '<br>آخر نسخة احتياطية: ' + last : '');
  if (S.meta.offlineDone === 3) $('#offlineInfo').textContent = 'المصحف كامل مع التفسير ومعاني الكلمات والبحث متحمّل على الجهاز ✓ — كله بيشتغل بدون إنترنت.';
}

$('#btnExport').onclick = async () => {
  const data = JSON.stringify(S.exportData(), null, 1);
  const d = new Date();
  const name = `mushaf-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
  const file = new File([data], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(hover:none)').matches) {
      await navigator.share({ files: [file], title: 'نسخة احتياطية — مصحف المراجعة' });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    S.setMeta('lastBackup', Date.now());
    renderSettings();
  } catch (e) { if (!e || e.name !== 'AbortError') toast('مقدرتش أصدّر الملف'); }
};
$('#btnImport').onclick = () => $('#importFile').click();
$('#importFile').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const n = await S.importData(JSON.parse(await f.text()));
    refresh(); renderSettings();
    chrome();
    toast(n ? 'اتضاف/اتحدّث ' + AR(n) + ' (أخطاء ومواضع وعلامات)' : 'كل اللي في الملف موجود بالفعل');
  } catch (_) { toast('الملف ده مش نسخة احتياطية من مصحف المراجعة'); }
};
$('#btnClear').onclick = async () => {
  if (!S.marks.size) return toast('مفيش أخطاء محفوظة');
  if (!confirm('هتمسح ' + S.marks.size + ' خطأ نهائيًا. متأكد؟')) return;
  await S.clearMarks();
  refresh(); renderSettings();
  toast('اتمسحت كل الأخطاء');
};

// تحميل المصحف كامل للعمل بدون نت
$('#btnDownload').onclick = async () => {
  if (!('caches' in self)) return toast('المتصفح ده مش بيدعم التحميل');
  const btn = $('#btnDownload'), bar = $('#dlProg');
  btn.disabled = true; bar.hidden = false;
  try {
    const fm = await loadFontMap();
    const urls = [...Object.keys(fm.fonts).map(fontUrl)];
    urls.push('data/text.json', 'data/mutashabihat.json');
    for (let p = 1; p <= PAGES; p++) urls.push(`data/${p}.json`, `data/tafsir/mukhtasar/${p}.json`, `data/gharib/${p}.json`);
    const cache = await caches.open('mushaf-data-v1');
    let done = 0, fail = 0, i = 0;
    const step = () => { done++; bar.firstElementChild.style.width = (done / urls.length * 100).toFixed(1) + '%'; btn.textContent = 'جاري التحميل ' + AR(Math.round(done / urls.length * 100)) + '٪'; };
    const worker = async () => {
      while (i < urls.length) {
        const u = urls[i++];
        try { if (!(await cache.match(u))) { const r = await fetch(u); if (!r.ok) throw 0; await cache.put(u, r); } } catch (_) { fail++; }
        step();
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    if (fail) { toast('اتحمّل الأغلب، و' + AR(fail) + ' ملف فشل — جرّب تاني'); btn.textContent = 'كمّل التحميل'; }
    else { S.setMeta('offlineDone', 3); btn.textContent = 'اتحمّل المصحف كامل ✓'; renderSettings(); S.requestPersist(); }
  } catch (_) { toast('التحميل فشل — اتأكد من الإنترنت'); btn.textContent = 'تحميل المصحف كاملًا'; }
  btn.disabled = false;
};

// تثبيت التطبيق
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installCard').hidden = false; });
$('#btnInstall').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#installCard').hidden = true; };

// ---------------- رسائل قصيرة ----------------
let toastT, snackAct = null;
// act: true = زرار «تراجع» للأخطاء، أو { label, fn } لأي إجراء تاني
function toast(msg, act = false) {
  const withUndo = !!act;
  snackAct = typeof act === 'object' ? act : null;
  $('#snackText').textContent = msg;
  $('#snackUndo').hidden = !withUndo;
  $('#snackUndo').textContent = snackAct ? snackAct.label : 'تراجع';
  $('#snack').classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(hideToast, withUndo ? 4000 : 2200);
}
function hideToast() { $('#snack').classList.remove('on'); }

// ---------------- البداية ----------------
(async () => {
  await S.init();
  applyHide();
  applyTheme();
  initMigration({
    S, toast,
    after: () => { applyHide(); applyTheme(); show(S.meta.lastPage || page); },
  });
  const q = new URLSearchParams(location.search);
  const start = +q.get('p') || S.meta.lastPage || 1;
  show(start);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
