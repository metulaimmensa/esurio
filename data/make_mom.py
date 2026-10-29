# Сборка маминой версии: python3 make_mom.py <version>
import json, os, shutil, sys, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from mom import adapt
ver = sys.argv[1]
DOCS = os.path.join(HERE, '..', 'docs'); OUT = '/home/claude/recipes-app-mom/docs'
shutil.rmtree(OUT, ignore_errors=True)
shutil.copytree(DOCS, OUT, ignore=shutil.ignore_patterns('apk', 'mom'))
src = open(os.path.join(DOCS, 'recipes.js')).read()
a = src.index('window.SEED_RECIPES = ') + len('window.SEED_RECIPES = '); b = src.index(';\nwindow.PRODUCT_CATS')
rs = [x for x in (adapt(r) for r in json.loads(src[a:b])) if x]
open(os.path.join(OUT, 'recipes.js'), 'w').write(src[:a] + json.dumps(rs, ensure_ascii=False, indent=0) + src[b:])
open(os.path.join(OUT, 'config.js'), 'w').write("window.ESURIO_CFG = { mom: true, versionPath: 'docs/mom/version.json' };\n")
app = open(os.path.join(OUT, 'app.js')).read()
import re
app = re.sub(r"const APP_VERSION = '[0-9.]+'", f"const APP_VERSION = '{ver}'", app)
open(os.path.join(OUT, 'app.js'), 'w').write(app)
print(len(rs), 'recipes for mom')
