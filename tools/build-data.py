#!/usr/bin/env python3
"""بناء بيانات البحث ومعاني الكلمات والمتشابهات.

المصادر (بتتحمّل تلقائيًا):
- نص الكلمات: حزمة quran-qcf4 على npm (رخصة MIT) — نفس ترقيم كلمات المصحف هنا (QCF4).
- معاني الكلمات: «السراج في بيان غريب القرآن» — محمد بن عبد العزيز الخضيري،
  من مستودع Muhammad95959/Tafsir-Kalimat-DB.
- المتشابهات: Waqar144/Quran_Mutashabihat_Data (CC0) — مبنية على عمل القارئ إدريس العاصم.

الناتج:
- data/text.json            [[سورة, آية, صفحة, "نص الآية كلمة كلمة", (أول كلمة في الصفحة التالية)], ...]
- data/gharib/<page>.json   {"سورة:آية": [[رقم_الكلمة, عدد_الكلمات, "الكلمة", "المعنى"], ...]}
- data/mutashabihat.json    {"سورة:آية": [{"s": ["سورة:آية"...], "m": [["سورة:آية"...], ...], "c": 1?}, ...]}

التشغيل من جذر المشروع:  python3 tools/build-data.py
"""
import io, json, os, re, sys, tarfile, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
QCF4 = 'https://registry.npmjs.org/quran-qcf4/-/quran-qcf4-1.1.0.tgz'
GHARIB = 'https://raw.githubusercontent.com/Muhammad95959/Tafsir-Kalimat-DB/main/kalimat.json'
MUTASH = 'https://raw.githubusercontent.com/Waqar144/Quran_Mutashabihat_Data/master/mutashabiha_data.json'
ZW = re.compile('[\u200b-\u200f\u2060\ufeff]')


def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (mushaf-build-data)'})
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 ** (i + 1))


def dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))


def our_pages():
    """كلمات كل صفحة في بيانات المصحف هنا: {"سورة:آية:كلمة": صفحة}"""
    where = {}
    for p in range(1, 605):
        with open(os.path.join(DATA, f'{p}.json'), encoding='utf-8') as f:
            for ln in json.load(f):
                for w in ln.get('w') or []:
                    if w.get('p'):
                        where.setdefault(f"{w['k']}:{w['p']}", p)
    return where


def build_text(where):
    print('quran-qcf4…', file=sys.stderr)
    tar = tarfile.open(fileobj=io.BytesIO(get(QCF4)), mode='r:gz')
    words = {}  # (s, a) -> {pos: text}
    for m in tar.getmembers():
        if not re.fullmatch(r'package/pages/\d{3}\.json', m.name):
            continue
        for ln in json.load(tar.extractfile(m))['lines']:
            for w in ln['words']:
                if w['type'] != 'word':
                    continue
                s, a = map(int, w['verse_key'].split(':'))
                t = ZW.sub('', w['text']).strip()
                if not t or ' ' in t:
                    sys.exit(f'كلمة غريبة: {w}')
                words.setdefault((s, a), {})[w['position']] = t
    if len(words) != 6236:
        sys.exit(f'عدد الآيات {len(words)}')
    rows = []
    for (s, a) in sorted(words):
        ws = words[(s, a)]
        n = len(ws)
        if sorted(ws) != list(range(1, n + 1)):
            sys.exit(f'ترقيم الكلمات ناقص في {s}:{a}')
        pages = [where.get(f'{s}:{a}:{i}') for i in range(1, n + 1)]
        if None in pages:
            sys.exit(f'كلمة مش موجودة في صفحات المصحف: {s}:{a}')
        row = [s, a, pages[0], ' '.join(ws[i] for i in range(1, n + 1))]
        if pages[-1] != pages[0]:
            row.append(next(i + 1 for i, p in enumerate(pages) if p != pages[0]))
        rows.append(row)
    dump(os.path.join(DATA, 'text.json'), rows)
    print(f'text.json: {len(rows)} آية', file=sys.stderr)
    return rows


def build_gharib(rows, where):
    print('السراج…', file=sys.stderr)
    nwords = {(r[0], r[1]): len(r[3].split(' ')) for r in rows}
    pages = {}
    n = 0
    for r in json.loads(get(GHARIB)):
        if r.get('surah_no') is None or r.get('word_no') is None:
            continue  # الاستعاذة: مش آية
        s, a, w, span = int(r['surah_no']), int(r['ayah_no']), int(r['word_no']), int(r.get('span') or 1)
        if not (1 <= w <= nwords.get((s, a), 0)):
            continue
        span = max(1, min(span, nwords[(s, a)] - w + 1))
        entry = [w, span, r['kalima'].strip(), r['tafsir'].strip()]
        for p in {where[f'{s}:{a}:{i}'] for i in range(w, w + span)}:
            pages.setdefault(p, {}).setdefault(f'{s}:{a}', []).append(entry)
        n += 1
    for p in range(1, 605):
        page = pages.get(p, {})
        for v in page.values():
            v.sort()
        dump(os.path.join(DATA, 'gharib', f'{p}.json'), page)
    print(f'gharib: {n} كلمة', file=sys.stderr)


def build_mutashabihat(rows):
    print('المتشابهات…', file=sys.stderr)
    keys = [f'{r[0]}:{r[1]}' for r in rows]  # الترتيب المطلق للآيات (من صفر)
    as_keys = lambda v: [keys[i] for i in (v if isinstance(v, list) else [v])]
    groups = []
    for juz in json.loads(get(MUTASH)).values():
        for e in juz:
            groups.append((tuple(as_keys(e['src']['ayah'])), [tuple(as_keys(m['ayah'])) for m in e['muts']], bool(e.get('ctx'))))
    out, seen = {}, set()

    def add(src, muts, ctx):
        muts = [m for m in muts if m != src]
        sig = (src, tuple(sorted(muts)))
        if not muts or sig in seen:
            return
        seen.add(sig)
        g = {'s': list(src), 'm': [list(m) for m in muts]}
        if ctx:
            g['c'] = 1
        for k in src:
            out.setdefault(k, []).append(g)

    for src, muts, ctx in groups:
        add(src, muts, ctx)
    # الاتجاه العكسي لو مش موجود: لو (أ) بتشبه (ب)، (ب) كمان بتشبه (أ)
    for src, muts, ctx in groups:
        for m in muts:
            if not any(src in [tuple(x) for x in g['m']] for g in out.get(m[0], [])):
                add(m, [src] + [x for x in muts if x != m], ctx)
    dump(os.path.join(DATA, 'mutashabihat.json'), out)
    print(f'mutashabihat: {len(out)} آية', file=sys.stderr)


def main():
    where = our_pages()
    rows = build_text(where)
    build_gharib(rows, where)
    build_mutashabihat(rows)


if __name__ == '__main__':
    main()
