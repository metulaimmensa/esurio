# Мамина версия: без острого, шоколада, грибов, орехов, зелёного лука, сырого чеснока.
import re
EXCLUDE = set('''tom-yum laksa kharcho-chicken doro-wat piri-piri moambe mafe aji-de-gallina mole-poblano xinxim fesenjan
kogi-tacos bibimbap peanut-noodles smashed-cucumbers sriracha-shrimp honey-sriracha-nuts sriracha-sauces shrimp-chili-crisp
chakalaka korean-carrot-salad chili-con-carne flygande-jacob mushroom-rice-soup cream-mushroom-soup pasta-chicken-mushroom
pasta-pesto'''.split())
STRIP = [
 ('острое', r'чили|шрирач|кайенск|халапен|бербере|гочуджан|кочхуджан|лао гань|самбал|харисс|митмит|аджик|^хрен|васаби|табаско|перец чёрный|перец белый|перец сушёный|^ахи|горчица дижонская|паста карри|паста том ям|паста лакса|кимчи|паприка острая|перец острый'),
 ('шоколад', r'шоколад|какао'),
 ('грибы', r'гриб|шампиньон|шиитаке|вешенк'),
 ('орехи', r'(?<!мускатный )орех|арахис|кешью|миндал|фундук|кедров|фисташ|пекан|^песто'),
 ('зелёный лук', r'лук зелёный|зелёный лук'),
]
RAW_GARLIC = {'bruschetta', 'gazpacho', 'pita-hummus', 'soy-lime-salad', 'ceviche', 'greek-salad', 'tuna-tartare', 'beef-tartare', 'salmon-tartare', 'okroshka', 'okroshka-classic', 'carpaccio-salad', 'tuna-egg-salad', 'chicken-mango-salad'}
BAD_VARIANT = r'шрирач|лао гань|остр|чили|гриб|орех|арахис|кешью|шоколад|кимчи|гочуджан|митмит'

def _bad(name, rid):
    n = name.lower()
    for lab, p in STRIP:
        if re.search(p, n): return lab
    if rid in RAW_GARLIC and 'чеснок' in n: return 'сырой чеснок'
    return None

def adapt(r):
    """None = рецепт исключён; иначе копия без запрещённого и с пометкой."""
    if r['id'] in EXCLUDE: return None
    removed = []
    def clean(ing):
        out = []
        for i in ing:
            b = _bad(i[0], r['id'])
            if b: removed.append(i[0])
            else: out.append(i)
        return out
    r = dict(r)
    r['ing'] = clean(r['ing'])
    if r.get('variants'):
        vs = []
        idx_map = {}
        for k, v in enumerate(r['variants']):
            if re.search(BAD_VARIANT, v['name'].lower()): continue
            v = dict(v); v['ing'] = clean(v.get('ing', []))
            idx_map[k] = len(vs); vs.append(v)
        r['variants'] = vs
        if r.get('default_vars'):
            r['default_vars'] = [idx_map[k] for k in r['default_vars'] if k in idx_map]
        if not vs: r.pop('variants'); r.pop('pick_one', None); r.pop('default_vars', None)
    if r.get('w'):
        r['w'] = dict(r['w']); r['w']['t'] = [t for t in r['w']['t'] if t not in ('hot',)] or ['umami']
        r['w']['t'] = ['sweet' if t == 'sws' else t for t in r['w']['t']]
    rem = sorted(set(removed))
    if rem:
        r['mom_note'] = 'Убрано: ' + ', '.join(rem).lower() + '. Если в шагах встречается — просто пропусти.'
    return r
