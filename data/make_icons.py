import json, os, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import build
KIT='/home/claude/kit2/Esurio_Final_Icons_110/'
NEW='/home/claude/icons_new/'
OUT='/home/claude/esurio/docs/img/'
man=json.load(open(KIT+'manifest.json'))['recipes']
alias={'Том кха':'Том кха — добрый брат-близнец том яма','Утиная грудка, три соуса':'Утиная грудка — три соуса','Чашу (свинина для рамена)':'Чашу — свинина для рамена'}
override={'Морковь по-корейски с курицей или креветками':NEW+'carrot.png','Квашеная капуста с луком':NEW+'kapusta.png'}
by_title={}
for m in man:
    t=alias.get(m['name'],m['name'])
    by_title[t]=override.get(m['name'],KIT+m['png_512'])
legacy=json.load(open(os.path.join(os.path.dirname(__file__),'legacy.json')))
extra={'syrniki':KIT+'png-512/01_syrniki.png','potato-honey-parm':NEW+'potato.png','kotlety':NEW+'kotlety.png'}
rs=build.load()
src={}
for r in rs:
    src[r['id']]=by_title[r['title']]
for r in legacy: src[r['id']]=extra[r['id']]
for d in ('i64','i256'): os.makedirs(OUT+d,exist_ok=True)
for rid,f in src.items():
    im=Image.open(f).convert('RGB')
    for sz,d in ((96,'i64'),(320,'i256')):
        im.resize((sz,sz),Image.LANCZOS).save(f'{OUT}{d}/{rid}.webp','WEBP',quality=82,method=6)
print(len(src))
