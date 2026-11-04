// الانتقال للعنوان الجديد (Cloudflare Pages) عشان المصحف مايتلخبطش مع تطبيق الحلقة على نفس الدومين.
// المتصفح بيفصل بيانات كل دومين، فبننقل الأخطاء والمواضع والعلامات والإعدادات في رابط واحد:
//   العنوان القديم → NEW_HOME#import=<البيانات مضغوطة> → العنوان الجديد يسأل ويضيفها.

export const NEW_HOME = 'https://mushaf-almuraja.pages.dev/';
const OLD_HOSTS = ['waytoallah.github.io'];
const SETTINGS = ['theme', 'reciter', 'repeat', 'cont', 'saveAudio', 'quick', 'defType', 'rubStyle', 'study', 'sort', 'lastPage', 'lastBackup', 'offlineDone'];

const b64u = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const gz = typeof CompressionStream !== 'undefined';

async function encode(obj) {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  if (!gz) return 'j' + b64u(json);
  const buf = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  return 'z' + b64u(new Uint8Array(buf));
}
async function decode(s) {
  const bytes = unb64u(s.slice(1));
  if (s[0] === 'j') return JSON.parse(new TextDecoder().decode(bytes));
  return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}

/**
 * ctx: { S, toast, after() } — after() بيحدّث الواجهة بعد الاستيراد
 */
export async function initMigration(ctx) {
  addEventListener('hashchange', () => { if (location.hash.startsWith('#import=')) receive(ctx); });
  if (location.hash.startsWith('#import=')) return receive(ctx);
  if (OLD_HOSTS.includes(location.hostname)) return offerMove(ctx);
}

// العنوان القديم: شريط «انقل بياناتي» — بيظهر بس لما العنوان الجديد يكون شغال فعلًا
async function offerMove({ S, toast }) {
  try {
    if (Date.now() - (S.meta.moveHiddenAt || 0) < 3 * 864e5) return; // اتقفل من قريب
    const r = await fetch(NEW_HOME + 'manifest.json', { cache: 'no-store' });
    if (!r.ok || (await r.json()).name !== 'مصحف المراجعة') return;
  } catch (_) { return; }
  const bar = document.getElementById('moved');
  bar.hidden = false;
  bar.querySelector('[data-go]').onclick = async () => {
    const settings = Object.fromEntries(SETTINGS.filter(k => S.meta[k] !== undefined).map(k => [k, S.meta[k]]));
    const data = await encode({ ...S.exportData(), settings });
    if (data.length > 1500000) { // كبير قوي على رابط: نصدّر ملف ونفتح الجديد
      toast('البيانات كبيرة — صدّر نسخة احتياطية من الإعدادات واستوردها في العنوان الجديد');
      return;
    }
    location.href = NEW_HOME + '#import=' + data;
  };
  bar.querySelector('[data-hide]').onclick = () => { bar.hidden = true; S.setMeta('moveHiddenAt', Date.now()); };
}

// العنوان الجديد: نسأل الأول (عشان محدش يبعت رابط يغيّر بيانات حد)، وبعدين نضيف
async function receive({ S, toast, after }) {
  const raw = location.hash.slice('#import='.length);
  history.replaceState(null, '', location.pathname + location.search);
  let obj;
  try { obj = await decode(raw); } catch (_) { return toast('رابط النقل ده بايظ — جرّب تاني من العنوان القديم'); }
  if (!obj || obj.app !== 'mushaf-app' || !Array.isArray(obj.marks)) return toast('رابط النقل ده بايظ — جرّب تاني من العنوان القديم');
  const nM = obj.marks.length, nB = (obj.bookmarks || []).length, nT = (obj.tracks || []).length;
  if (!confirm(`نقل بياناتك من العنوان القديم:\n${nM} خطأ، ${nB} علامة، ${nT} موضع قراءة، والإعدادات.\nتضيفها هنا؟`)) return;
  // النقل مقصود: مواضع القراءة والصفحة الأخيرة من القديم بتكسب (الجديد لسه فيه الافتراضي بس)
  const okTrack = t => t && typeof t.id === 'string' && typeof t.name === 'string' && +t.page >= 1 && +t.page <= 604;
  if (Array.isArray(obj.tracks) && obj.tracks.some(okTrack)) {
    const ids = new Set(obj.tracks.map(t => t.id));
    await S.setMeta('tracks', [...obj.tracks.filter(okTrack), ...(S.meta.tracks || []).filter(t => !ids.has(t.id))]);
    if (obj.activeTrack && ids.has(obj.activeTrack)) await S.setMeta('activeTrack', obj.activeTrack);
  }
  const n = await S.importData(obj);
  const st = obj.settings || {};
  for (const [k, v] of Object.entries(st)) if (SETTINGS.includes(k) && (S.meta[k] === undefined || k === 'lastPage')) await S.setMeta(k, v);
  await S.setMeta('migratedAt', Date.now());
  S.requestPersist();
  after();
  toast('اتنقلت بياناتك ✓ (' + n.toLocaleString('ar-EG') + ') — ثبّت التطبيق من هنا وامسح الأيقونة القديمة');
}
