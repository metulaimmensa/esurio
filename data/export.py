import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build import load, compute
from nutrition import N
from tags import TAGS

legacy = json.load(open(os.path.join(HERE, 'legacy.json')))
for r in legacy:
    r['cuisine'] = 'домашняя'; r['v'] = r.get('v', 1) + 1
    r['type'] = r['type']
TIP_KEYS = [('compare', 'Чихиртма или авголемоно'), ('why', 'Почему могло не получаться'), ('tomatoes', 'Какие томаты брать'),
            ('pan', 'Какая сковорода'), ('choose', 'Как выбрать мясо'), ('subs', 'Замены')]
out = []
for r in map(compute, load()):
    x = {k: r[k] for k in ('id', 'title', 'emoji', 'type', 'cuisine', 'difficulty', 'time', 'servings', 'kcal', 'p', 'f', 'c', 'desc', 'ing', 'steps') }
    x['v'] = 1; x['tags'] = r.get('tags', []); x['notes'] = r.get('notes', '')
    x['tips'] = [[t, r[k]] for k, t in TIP_KEYS if r.get(k)]
    if r.get('src'): x['src'] = r['src']
    if r.get('pick_one'): x['pick_one'] = True
    if r.get('default_vars'): x['default_vars'] = r['default_vars']
    if r.get('yields'): x['yields'] = r['yields']
    if r.get('variants'):
        x['variants'] = [{k: v[k] for k in ('name', 'ing', 'minus', 'note', 'dkcal', 'dp', 'df', 'dc', 'yields', 'steps') if k in v} for v in r['variants']]
    for i in x['ing'] + [j for v in x.get('variants', []) for j in v.get('ing', [])]:
        if len(i) > 3 and not i[3]: i.pop()
    out.append(x)
allr = legacy + out
for r in allr:
    if r['id'] in TAGS: r['w'] = TAGS[r['id']]
cats = {k: v['cat'] for k, v in N.items()}
cats.update({'Лимон (цедра)': 'Овощи и фрукты', 'Масло подсолнечное': 'Бакалея', 'Сметана или варенье к подаче': 'Молочное', 'Вода ледяная': 'Специи'})
aliases = {'Яйцо (нужны желтки)': 'Яйцо', 'Яйцо (нужен желток)': 'Яйцо', 'Желток': 'Яйцо', 'Масло подсолнечное': 'Масло растительное'}
js = ('// Сгенерировано из data/*.py — правки вносить туда.\n'
      'window.SEED_RECIPES = ' + json.dumps(allr, ensure_ascii=False, indent=0) + ';\n'
      'window.PRODUCT_CATS = ' + json.dumps(cats, ensure_ascii=False) + ';\n'
      'window.PRODUCT_ALIASES = ' + json.dumps(aliases, ensure_ascii=False) + ';\n')
open(os.path.join(HERE, '..', 'docs', 'recipes.js'), 'w').write(js)
print(len(allr), 'recipes,', len(js), 'bytes')
