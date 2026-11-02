// تلاوة الآيات: ملف صوت لكل آية من everyayah.com (بيشتغل بالإنترنت بس).
// المشغّل: تكرار الآية، والانتقال للآية اللي بعدها، والبسملة قبل أول كل سورة (غير الفاتحة والتوبة).

import { SURAS, suraName, AR } from './quran.js';

// أسماء الفولدرات زي ما هي على everyayah.com/data/
export const RECITERS = [
  { id: 'Husary_128kbps', name: 'محمود خليل الحصري' },
  { id: 'Husary_Muallim_128kbps', name: 'الحصري — المصحف المعلّم' },
  { id: 'Minshawy_Murattal_128kbps', name: 'محمد صديق المنشاوي' },
  { id: 'Abdul_Basit_Murattal_192kbps', name: 'عبد الباسط عبد الصمد' },
  { id: 'Alafasy_128kbps', name: 'مشاري راشد العفاسي' },
  { id: 'Ghamadi_40kbps', name: 'سعد الغامدي' },
  { id: 'Maher_AlMuaiqly_64kbps', name: 'ماهر المعيقلي' },
  { id: 'Abdurrahmaan_As-Sudais_192kbps', name: 'عبد الرحمن السديس' },
  { id: 'Saood_ash-Shuraym_128kbps', name: 'سعود الشريم' },
  { id: 'Hudhaify_128kbps', name: 'علي الحذيفي' },
  { id: 'Muhammad_Ayyoub_128kbps', name: 'محمد أيوب' },
  { id: 'Abu_Bakr_Ash-Shaatree_128kbps', name: 'أبو بكر الشاطري' },
  { id: 'Yasser_Ad-Dussary_128kbps', name: 'ياسر الدوسري' },
  { id: 'Nasser_Alqatami_128kbps', name: 'ناصر القطامي' },
];
export const DEFAULT_RECITER = RECITERS[0].id;
export const reciterName = id => (RECITERS.find(r => r.id === id) || RECITERS[0]).name;

const pad = n => String(n).padStart(3, '0');
export const audioUrl = (rec, s, a) => `https://everyayah.com/data/${rec}/${pad(s)}${pad(a)}.mp3`;

export function nextAyah(s, a) { return a < SURAS[s - 1][1] ? [s, a + 1] : s < 114 ? [s + 1, 1] : null; }
export function prevAyah(s, a) { return a > 1 ? [s, a - 1] : s > 1 ? [s - 1, SURAS[s - 2][1]] : null; }
const needsBasmala = (s, a) => a === 1 && s !== 1 && s !== 9;

/**
 * hooks.options() → { reciter, repeat (عدد مرات الآية، 0 = بلا نهاية), cont (يكمّل للي بعدها) }
 * hooks.change(state) — كل ما الحالة تتغير. state = null لما المشغّل يقف خالص.
 * hooks.error() — الملف ماشتغلش (غالبًا مفيش نت).
 */
export function createPlayer(hooks) {
  const el = new Audio();
  const pre = new Audio(); // تحميل الآية اللي بعدها مسبقًا عشان مايبقاش فيه سكتة
  el.preload = pre.preload = 'auto';
  let st = null; // { s, a, rep, bsm }

  const state = () => st && { s: st.s, a: st.a, rep: st.rep, bsm: st.bsm, playing: !el.paused };
  const emit = () => { hooks.change(state()); media(); };

  function load() {
    const { reciter } = hooks.options();
    el.src = st.bsm ? audioUrl(reciter, 1, 1) : audioUrl(reciter, st.s, st.a);
    el.play().catch(e => { if (e && e.name !== 'AbortError') emit(); });
    const n = st.bsm ? [st.s, st.a] : nextAyah(st.s, st.a);
    if (n) pre.src = needsBasmala(...n) && !st.bsm ? audioUrl(reciter, 1, 1) : audioUrl(reciter, n[0], n[1]);
    emit();
  }
  function go(s, a) { st = { s, a, rep: 1, bsm: needsBasmala(s, a) }; load(); }

  el.addEventListener('ended', () => {
    if (!st) return;
    if (st.bsm) { st.bsm = false; return load(); }
    const { repeat, cont } = hooks.options();
    if (repeat === 0 || st.rep < repeat) { st.rep++; el.currentTime = 0; el.play(); return emit(); }
    const n = cont && nextAyah(st.s, st.a);
    if (n) return go(...n);
    st.rep = 1; // خلص: يفضل واقف على نفس الآية
    emit();
  });
  el.addEventListener('play', emit);
  el.addEventListener('pause', emit);
  el.addEventListener('error', () => { if (st && el.getAttribute('src')) { el.pause(); hooks.error(); emit(); } });

  // أزرار الشاشة المقفولة والسماعة
  function media() {
    if (!('mediaSession' in navigator)) return;
    if (!st) { navigator.mediaSession.metadata = null; return; }
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'سورة ' + suraName(st.s) + ' · آية ' + AR(st.a),
        artist: reciterName(hooks.options().reciter),
        album: 'مصحف المراجعة',
        artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
      });
      navigator.mediaSession.playbackState = el.paused ? 'paused' : 'playing';
    } catch (_) {}
  }
  if ('mediaSession' in navigator) {
    const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (_) {} };
    h('play', () => api.toggle());
    h('pause', () => api.toggle());
    h('nexttrack', () => api.next());
    h('previoustrack', () => api.prev());
    h('stop', () => api.stop());
  }

  const api = {
    playFrom: (s, a) => go(s, a),
    toggle() {
      if (!st) return;
      if (el.paused) { if (el.ended) el.currentTime = 0; el.play().catch(() => {}); } else el.pause();
    },
    next() { const n = st && nextAyah(st.s, st.a); if (n) go(...n); },
    prev() {
      if (!st) return;
      if (el.currentTime > 2 && !st.bsm) { el.currentTime = 0; return el.paused && el.play(); } // زي أي مشغّل: يرجع لأول الآية
      const p = prevAyah(st.s, st.a); if (p) go(...p);
    },
    stop() { el.pause(); el.removeAttribute('src'); el.load(); st = null; emit(); },
    // بعد تغيير القارئ: نفس الآية بالصوت الجديد
    reload() { if (st) { const was = !el.paused; load(); if (!was) el.pause(); } },
    state,
  };
  return api;
}
