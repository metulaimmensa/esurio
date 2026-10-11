import os, sys, json, importlib
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from nutrition import N

def grams(name, amt, unit):
    n = N[name]
    u = unit
    if n['kcal'] == 0: return 0
    if u in ('г', 'мл'): return amt
    if u in ('кг', 'л'): return amt * 1000
    if u in ('шт', 'банка', 'зуб.'):
        if n['pc'] is None: raise ValueError(f'нет веса штуки: {name}')
        return amt * n['pc']
    if u == 'ст.л.': return amt * (n['tbsp'] or 15)
    if u == 'ч.л.': return amt * (n['tbsp'] or 15) / 3
    if u == 'щепотка': return amt * 0.5
    if u == 'кап.': return 0
    if u == 'пучок': return amt * 30
    raise ValueError(f'неизвестная единица {u} у {name}')

def nut(ings):
    t = dict(kcal=0, p=0, f=0, c=0)
    for i in ings:
        name, amt, unit = i[0], i[1], i[2]
        o = i[3] if len(i) > 3 else {}
        if o.get('opt'): continue
        g = grams(name, amt, unit) * N[name]['eff']
        for k in t: t[k] += N[name][k] * g / 100
    return t

def load():
    out = []
    for mod in ['r_breakfast', 'r_soups', 'r_mains', 'r_salads', 'r_video']:
        try: m = importlib.import_module(mod)
        except ModuleNotFoundError: continue
        out += m.R
    return out

def compute(r):
    s = r['servings']
    base = nut(r['ing'])
    r['kcal'], r['p'], r['f'], r['c'] = [round(base[k] / s) for k in ('kcal', 'p', 'f', 'c')]
    for v in r.get('variants', []):
        add = nut(v.get('ing', []))
        minus = nut([i for i in r['ing'] if i[0] in v.get('minus', [])])
        v['dkcal'] = round((add['kcal'] - minus['kcal']) / s)
        v['dp'] = round((add['p'] - minus['p']) / s); v['df'] = round((add['f'] - minus['f']) / s); v['dc'] = round((add['c'] - minus['c']) / s)
    return r

if __name__ == '__main__':
    rs = load(); bad = set()
    for r in rs:
        for i in r['ing'] + [x for v in r.get('variants', []) for x in v.get('ing', [])]:
            if i[0] not in N: bad.add(i[0])
    if bad: print('НЕТ В БАЗЕ:', bad); sys.exit(1)
    for r in rs: compute(r)
    for r in rs:
        vs = ', '.join(f"{v['name']}: {v['dkcal']:+d}" for v in r.get('variants', []))
        print(f"{r['title'][:38]:38} {r['servings']}п {r['kcal']:5} ккал  Б{r['p']:3} Ж{r['f']:3} У{r['c']:3}  {vs[:90]}")
    print(len(rs), 'рецептов')
