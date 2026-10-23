import { SURAS, PAGES, JUZ_NAME, JUZ_PAGE, juzOfPage, suraPage, surasOnPage, suraName, pageOfAyah, AR } from './quran.js';
import * as S from './store.js';
import { renderPage, repaint, prefetch, loadFontMap, loadFont, fontUrl } from './mushaf.js';

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

async function show(p, dir = 0, focusId = null) {
  p = Math.max(1, Math.min(PAGES, p | 0));
  page = p;
  S.setMeta('lastPage', p);
  chrome();
  const tok = ++renderTok;
  stage.querySelectorAll('.sheet,.miss').forEach(e => e.remove());
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.style.opacity = '0';
  if (dir) sheet.style.transform = `translateX(${dir > 0 ? -50 : 50}px)`;
  stage.prepend(sheet);
  try {
    await renderPage(sheet, stage, p, classFor);
    if (tok !== renderTok) return;
    requestAnimationFrame(() => { sheet.style.opacity = '1'; sheet.style.transform = ''; });
    if (focusId) {
      const el = sheet.querySelector(`.w[data-id="${focusId}"]`);
      if (el) el.classList.add('pulse');
    }
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
  $('#tJuz').textContent = 'الجزء ' + JUZ_NAME[juzOfPage(page) - 1];
  $('#pNum').textContent = AR(page);
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
  openLayer('#wordSheet');
}

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

function jumpTo(p, focusId) {
  // نقفل كل الطبقات الأول وبعدين ننتقل
  const n = stack.length;
  if (n) history.go(-n);
  show(p, 0, focusId);
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

// ---------------- الإعدادات ----------------
$('#btnSettings').onclick = () => { renderSettings(); openLayer('#panelSettings'); };
$('#setDefault').innerHTML = TYPES.map(t => `<option value="${t.key}">${t.name}</option>`).join('');
$('#setQuick').onchange = e => S.setMeta('quick', e.target.checked);
$('#setDefault').onchange = e => S.setMeta('defType', e.target.value);

async function renderSettings() {
  $('#setQuick').checked = !!S.meta.quick;
  $('#setDefault').value = S.meta.defType || 'hifz';
  const persisted = await S.isPersisted();
  const n = S.marks.size;
  const last = S.meta.lastBackup ? new Date(S.meta.lastBackup).toLocaleDateString('ar-EG') : null;
  $('#persistInfo').innerHTML =
    `محفوظ على الجهاز: <b>${AR(n)}</b> خطأ` +
    (S.storageMode() === 'ls' ? ' (تخزين احتياطي — المتصفح ده مش بيدعم IndexedDB)' : '') + '.<br>' +
    (persisted ? 'المتصفح موافق على الحفظ الدائم ✓' : 'المتصفح لسه ماأكدش الحفظ الدائم — تثبيت التطبيق على الشاشة الرئيسية بيساعد.') +
    (last ? '<br>آخر نسخة احتياطية: ' + last : '');
  if (S.meta.offlineDone) $('#offlineInfo').textContent = 'المصحف كامل متحمّل على الجهاز ✓ — كل الصفحات بتشتغل بدون إنترنت.';
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
    toast(n ? 'اتضاف/اتحدّث ' + AR(n) + ' خطأ' : 'كل الأخطاء اللي في الملف موجودة بالفعل');
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
    for (let p = 1; p <= PAGES; p++) urls.push(`data/${p}.json`);
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
    else { S.setMeta('offlineDone', true); btn.textContent = 'اتحمّل المصحف كامل ✓'; renderSettings(); S.requestPersist(); }
  } catch (_) { toast('التحميل فشل — اتأكد من الإنترنت'); btn.textContent = 'تحميل المصحف كاملًا'; }
  btn.disabled = false;
};

// تثبيت التطبيق
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installCard').hidden = false; });
$('#btnInstall').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#installCard').hidden = true; };

// ---------------- رسائل قصيرة ----------------
let toastT;
function toast(msg, withUndo = false) {
  $('#snackText').textContent = msg;
  $('#snackUndo').hidden = !withUndo;
  $('#snack').classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(hideToast, withUndo ? 4000 : 2200);
}
function hideToast() { $('#snack').classList.remove('on'); }

// ---------------- البداية ----------------
(async () => {
  await S.init();
  applyHide();
  const q = new URLSearchParams(location.search);
  const start = +q.get('p') || S.meta.lastPage || 1;
  show(start);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
