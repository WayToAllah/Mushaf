#!/usr/bin/env python3
"""تحميل «المختصر في التفسير» من QuranEnc وتقسيمه على صفحات المصحف.

الناتج: data/tafsir/mukhtasar/<page>.json = {"سورة:آية": "نص التفسير", ...}
الآية اللي بتكمل في الصفحة اللي بعدها بتتكرر في الصفحتين.

التشغيل من جذر المشروع:  python3 tools/fetch-tafsir.py
"""
import json, os, sys, time, urllib.request

KEY = 'arabic_mokhtasar'
API = 'https://quranenc.com/api/v1/translation/sura/{key}/{sura}'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'tafsir', 'mukhtasar')


def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (mushaf-tafsir-fetch)'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(2 ** (i + 1))


def main():
    tafsir = {}
    for s in range(1, 115):
        for row in get(API.format(key=KEY, sura=s))['result']:
            tafsir[f"{int(row['sura'])}:{int(row['aya'])}"] = row['translation'].strip()
        print(f'\rسورة {s}/114', end='', file=sys.stderr)
    print(file=sys.stderr)
    if len(tafsir) != 6236:
        sys.exit(f'عدد الآيات {len(tafsir)} بدل 6236')

    os.makedirs(OUT, exist_ok=True)
    seen = set()
    for p in range(1, 605):
        with open(os.path.join(ROOT, 'data', f'{p}.json'), encoding='utf-8') as f:
            lines = json.load(f)
        keys = []
        for ln in lines:
            for w in ln.get('w') or []:
                if w['k'] not in keys:
                    keys.append(w['k'])
        page = {k: tafsir[k] for k in keys}
        seen.update(keys)
        with open(os.path.join(OUT, f'{p}.json'), 'w', encoding='utf-8') as f:
            json.dump(page, f, ensure_ascii=False, separators=(',', ':'))
    missing = set(tafsir) - seen
    if missing:
        sys.exit(f'آيات مش موجودة في أي صفحة: {sorted(missing)[:10]}')
    print('تم: 604 صفحة', file=sys.stderr)


if __name__ == '__main__':
    main()
