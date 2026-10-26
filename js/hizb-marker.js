// علامة ربع الحزب — تصميم #10 «القوس الفاتح» (من hizb-marker-spec.md).
// القوس + حلقة من ٤ أجزاء + نجمة ثمانية + رقم الحزب + الكلمة.

const C = { gold: '#B08D3C', ink: '#1F3D2B', muted: '#5B5545', track: '#E6DCC3', bg: '#FFFCF4' };
const WORDS = { 1: 'ربع', 2: 'نصف', 3: 'ثلاثة أرباع', 4: 'بداية' };
const AR = n => String(n).replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);

// quarter: 1 ربع، 2 نصف، 3 ثلاثة أرباع، 4 بداية حزب جديد (hizb = رقم الحزب الجديد)
export function createMarker(hizb, quarter) {
  const word = WORDS[quarter], num = AR(hizb);
  const seg = i => (i <= quarter ? C.gold : C.track);
  const label = quarter === 4 ? `بداية الحزب ${num}` : `${word} الحزب ${num}`;
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="hizb-marker" viewBox="0 0 164 232" role="img" aria-label="${label}">
  <title>${label}</title>
  <path d="M1.5,82 A80.5,80.5 0 0 1 162.5,82 L162.5,212 Q162.5,230.5 144,230.5 L20,230.5 Q1.5,230.5 1.5,212 Z" fill="none" stroke="${C.gold}" stroke-width="1"/>
  <path d="M7,82 A75,75 0 0 1 157,82 L157,211 Q157,225 143,225 L21,225 Q7,225 7,211 Z" fill="${C.bg}" stroke="${C.gold}" stroke-width="1.5"/>
  <g transform="translate(32 29)">
    <g transform="rotate(-84.6 50 50)" fill="none" stroke-width="5" stroke-linecap="round">
      ${[0, 1, 2, 3].map(k => `<circle cx="50" cy="50" r="44" pathLength="100" stroke-dasharray="22 78" stroke-dashoffset="${-25 * k}" stroke="${seg(k + 1)}"/>`).join('')}
    </g>
    <polygon transform="translate(50 50) scale(0.82) translate(-50 -50)" fill="none" stroke="${C.gold}" stroke-width="1.5" stroke-linejoin="round"
      points="50,14 60.54,24.55 75.46,24.54 75.45,39.46 86,50 75.45,60.54 75.46,75.46 60.54,75.45 50,86 39.46,75.45 24.54,75.46 24.55,60.54 14,50 24.55,39.46 24.54,24.54 39.46,24.55"/>
    <text x="50" y="61" text-anchor="middle" font-family="Amiri, serif" font-size="30" font-weight="700" fill="${C.ink}">${num}</text>
  </g>
  <text x="82" y="168" text-anchor="middle" font-family="Amiri, serif" font-size="${word.length > 5 ? 20 : 26}" font-weight="700" fill="${C.ink}">${word}</text>
  <text x="82" y="198" text-anchor="middle" font-family="Amiri, serif" font-size="19" fill="${C.muted}">الحزب</text>
</svg>`;
  return tpl.content.firstElementChild;
}

// مركز الحلقة على ارتفاع 79 من 164 من عرض العلامة
export const RING_CENTER = 79 / 164;

// ۞ صغيرة فوق أول كلمة في الربع
export function inlineStar() {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg class="hizb-inline-star" viewBox="0 0 100 100" aria-hidden="true">
  <rect x="20" y="20" width="60" height="60" fill="none" stroke="${C.gold}" stroke-width="7" stroke-linejoin="round"/>
  <polygon points="50,7.57 92.43,50 50,92.43 7.57,50" fill="none" stroke="${C.gold}" stroke-width="7" stroke-linejoin="round"/>
  <circle cx="50" cy="50" r="9" fill="${C.gold}"/></svg>`;
  return tpl.content.firstElementChild;
}
