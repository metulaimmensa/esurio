'use strict';
/* ================= Хранилище ================= */
const KEY = 'kitchen.v1';
const DEFAULT_STATE = {
  recipes: {},          // пользовательские и отредактированные рецепты (id -> recipe)
  deleted: [],          // удалённые встроенные
  plan: {},             // 'YYYY-MM-DD' -> [{id, rid, slot, portions, done}]
  pantry: { 'Соль': true, 'Перец чёрный': true, 'Масло растительное': true, 'Вода ледяная': true },
  customProducts: [],
  extras: [],           // ручные позиции в списке покупок [{name, done}]
  settings: { people: 2, shopDays: 7 },
  timers: [],
  profiles: [{ id: 's', name: 'Сергей', goal: 1800, share: 60 }, { id: 'j', name: 'Юля', goal: 1450, share: 40 }],
  cook: { 0: 's', 1: 'j', 2: 'j', 3: 's', 4: 'j', 5: 's', 6: 'j' }, // день недели (0 = вс) -> кто готовит
  cookOverride: {},     // 'YYYY-MM-DD' -> id профиля
  ts: {},               // метки времени изменений для синхронизации: ключ -> ms
  me: null,             // кто пользуется этим устройством (не синхронизируется)
};
let S;
function load() {
  try { S = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { S = {}; }
  for (const k in DEFAULT_STATE) if (S[k] === undefined) S[k] = JSON.parse(JSON.stringify(DEFAULT_STATE[k]));
  S.settings = Object.assign({}, DEFAULT_STATE.settings, S.settings);
  // миграция: у старых записей нет id/даты
  S.extras = (S.extras || []).map(x => x.id ? x : Object.assign({ id: Math.random().toString(36).slice(2, 9) }, x));
  for (const d in S.plan) for (const e of S.plan[d]) e.date = d;
  if (Array.isArray(S.deleted)) S.deleted = Object.fromEntries(S.deleted.map(id => [id, true]));
}
const now = () => Date.now();
function mark(...keys) { const t = now(); keys.forEach(k => S.ts[k] = t); }
/* Бульоны считаются порциями по 250 мл (кубик концентрата ≈ порция). Остальное — просто «есть / нет». */
const PORTION_ML = 250;
const QTY = new Set(['Куриный бульон', 'Мясной бульон', 'Креветочный бульон']);
const SUBS = { 'Мясной бульон': ['Куриный бульон'], 'Куриный бульон': ['Мясной бульон'] }; // взаимозаменяемы, если родного нет
const qty = n => { const v = S.pantry[n]; return typeof v === 'number' ? v : (v ? 4 : 0); }; // старое «есть» = ~1 л
function setHave(n, v) { S.pantry[n] = QTY.has(n) ? (v === true ? (qty(n) || 4) : Math.max(0, +v || 0)) : !!v; mark('p:' + n); }
function addQty(n, k) { S.pantry[n] = Math.max(0, qty(n) + k); mark('p:' + n); }
const have = n => QTY.has(n) ? qty(n) > 0 : !!S.pantry[n];
const subOf = n => have(n) ? n : (SUBS[n] || []).find(have) || null; // что реально возьмём со склада
const haveAny = n => !!subOf(n);
function portionsOf(i, k = 1) { const a = ingAmt(i) * k, u = ingUnit(i); const ml = u === 'мл' ? a : u === 'л' ? a * 1000 : PORTION_ML; return Math.max(1, Math.round(ml / PORTION_ML)); }
// база, которая не кончается от одного блюда: не списывается и не считается «недостающей»
const BASE = new Set(['Соль', 'Перец чёрный', 'Масло растительное', 'Вода', 'Вода ледяная']);
function save(quiet) { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Не удалось сохранить'); } if (!quiet) { try { Sync.later(); } catch (e) { } } }
load();

/* ================= Утилиты ================= */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const TYPES = ['завтрак', 'первое', 'второе', 'гарнир', 'салат', 'перекус', 'десерт', 'напиток', 'соус', 'заготовка', 'особый случай'];
const SLOTS = ['Завтрак', 'Обед', 'Ужин', 'Перекус'];
const DIFF = ['', 'легко', 'средне', 'сложно'];
const diffDots = d => '●'.repeat(d) + '○'.repeat(3 - d);
const canon = n => (window.PRODUCT_ALIASES[n] || n).trim();
const catOf = n => window.PRODUCT_CATS[n] || window.PRODUCT_CATS[canon(n)] || ({ 'Яйца': 'Яйца' })[canon(n)] || 'Другое';

function fmtNum(x, unit) {
  if (!isFinite(x)) return '';
  let v;
  if (unit === 'г' || unit === 'мл') v = x >= 100 ? Math.round(x / 5) * 5 : Math.round(x);
  else v = Math.round(x * 2) / 2;
  if (v === 0 && x > 0) v = unit === 'г' || unit === 'мл' ? 1 : 0.5;
  const whole = Math.floor(v), frac = v - whole;
  if (frac === 0.5) return (whole ? whole : '') + '½';
  return String(v).replace('.', ',');
}
const fmtAmt = (a, u) => a ? `${fmtNum(a, u)} ${u}` : u;
const fmtDur = m => m >= 120 ? `${Math.floor(m / 60)} ч${m % 60 ? ' ' + (m % 60) + ' мин' : ''}` : `${m} мин`;
const fmtTime = s => { s = Math.max(0, Math.ceil(s)); const m = Math.floor(s / 60), r = s % 60; return `${m}:${String(r).padStart(2, '0')}`; };

function iso(d) { const z = new Date(d); z.setHours(12, 0, 0, 0); return z.toISOString().slice(0, 10); }
function addDays(d, n) { const z = new Date(d); z.setDate(z.getDate() + n); return z; }
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function dayLabel(dateIso) {
  const t = iso(new Date());
  if (dateIso === t) return 'Сегодня';
  if (dateIso === iso(addDays(new Date(), -1))) return 'Вчера';
  if (dateIso === iso(addDays(new Date(), 1))) return 'Завтра';
  if (dateIso === iso(addDays(new Date(), 2))) return 'Послезавтра';
  const d = new Date(dateIso + 'T12:00:00');
  return `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`;
}

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }

/* ================= Рецепты ================= */
function normRecipe(r) {
  return Object.assign({ tags: [], ing: [], steps: [], notes: '', desc: '', emoji: '🍽', servings: 2, difficulty: 1, time: 30, kcal: 0, p: 0, f: 0, c: 0, type: 'второе' }, r);
}
function allRecipes() {
  const map = {};
  for (const r of window.SEED_RECIPES) if (!S.deleted[r.id]) map[r.id] = normRecipe(r);
  for (const id in S.recipes) {
    const u = S.recipes[id];
    // пользовательская правка встроенного рецепта уступает новой версии из приложения, только если правки не было
    map[id] = normRecipe(u);
  }
  return Object.values(map);
}
const getRecipe = id => allRecipes().find(r => r.id === id);
const ingName = i => i[0], ingAmt = i => +i[1] || 0, ingUnit = i => i[2] || '', ingOpt = i => (i[3] || {});

/* ---- варианты: pick_one — ровно один на выбор, иначе — добавки по желанию ---- */
const hasVars = r => !!(r && r.variants && r.variants.length);
const defaultVars = r => (r && r.default_vars) ? r.default_vars.slice() : (r && r.pick_one && hasVars(r)) ? [0] : [];
function cleanVars(r, vars) { const v = (vars || []).filter(i => hasVars(r) && r.variants[i]); return (r && r.pick_one && hasVars(r) && !v.length) ? [0] : v; }
function effIng(r, vars) {
  const vs = cleanVars(r, vars).map(i => r.variants[i]);
  const minus = new Set(vs.flatMap(v => v.minus || []));
  let ing = r.ing.filter(i => !minus.has(ingName(i)));
  vs.forEach(v => { ing = ing.concat(v.ing || []); });
  return ing;
}
function effNut(r, vars) {
  const t = { kcal: r.kcal, p: r.p, f: r.f, c: r.c };
  cleanVars(r, vars).forEach(i => { const v = r.variants[i]; t.kcal += v.dkcal || 0; t.p += v.dp || 0; t.f += v.df || 0; t.c += v.dc || 0; });
  return t;
}
// чего не хватает для блюда по складу (без базовых, без «по желанию», без воды)
function missing(r, vars) {
  const out = new Set();
  for (const i of effIng(r, vars || defaultVars(r))) { const o = ingOpt(i), n = canon(ingName(i)); if (o.staple || o.opt || BASE.has(n)) continue; if (!haveAny(n)) out.add(n); }
  return [...out];
}
const varLabel = (r, vars) => cleanVars(r, vars).map(i => r.variants[i].name).join(', ');
function toggleVar(r, vars, i) {
  vars = cleanVars(r, vars);
  if (r.pick_one) return [i];
  return vars.includes(i) ? vars.filter(x => x !== i) : [...vars, i].sort((a, b) => a - b);
}
function varChips(r, vars, attr) {
  if (!hasVars(r)) return '';
  vars = cleanVars(r, vars);
  return `<div class="chips wrap">${r.variants.map((v, i) => `<button class="chip ${vars.includes(i) ? 'on' : ''}" ${attr}="${i}">${r.pick_one ? '' : (vars.includes(i) ? '✓ ' : '＋ ')}${esc(v.name.replace(/^\+ /, ''))}${v.dkcal ? ` <span class="small">${v.dkcal > 0 ? '+' : ''}${v.dkcal}</span>` : ''}</button>`).join('')}</div>`;
}

/* ================= Навигация ================= */
let tab = 'recipes';
const stack = []; // [{view, arg}]
const filters = { q: '', type: '', cuisine: '', diff: 0, maxTime: 0, have: false };

function go(view, arg, push = true) {
  if (push) stack.push({ view, arg });
  render();
  window.scrollTo(0, 0);
}
function back() { if (stack.length > 1) { stack.pop(); render(); window.scrollTo(0, 0); } }
function setTab(t) {
  tab = t; stack.length = 0; stack.push({ view: t });
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  render(); window.scrollTo(0, 0);
}
function render() {
  const cur = stack[stack.length - 1] || { view: tab };
  $('#backBtn').classList.toggle('hidden', stack.length <= 1);
  const V = VIEWS[cur.view];
  $('#title').textContent = typeof V.title === 'function' ? V.title(cur.arg) : V.title;
  $('#view').innerHTML = V.html(cur.arg);
  V.bind && V.bind(cur.arg);
}

/* ================= Экран: список рецептов ================= */
const VIEWS = {};
VIEWS.recipes = {
  title: 'Рецепты',
  html() {
    const rs = allRecipes();
    const usedTypes = TYPES.filter(t => rs.some(r => r.type === t));
    const cuisines = [...new Set(rs.map(r => r.cuisine).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    let list = rs.filter(r =>
      (!filters.q || (r.title + ' ' + r.tags.join(' ') + ' ' + (r.cuisine || '') + ' ' + r.ing.map(ingName).join(' ') + ' ' + (r.variants || []).flatMap(v => (v.ing || []).map(ingName)).join(' ')).toLowerCase().includes(filters.q.toLowerCase())) &&
      (!filters.type || r.type === filters.type) &&
      (!filters.cuisine || r.cuisine === filters.cuisine) &&
      (!filters.diff || r.difficulty === filters.diff) &&
      (!filters.maxTime || r.time <= filters.maxTime));
    list.sort((a, b) => (filters.have ? missing(a).length - missing(b).length : 0) || a.title.localeCompare(b.title, 'ru'));
    return `
      <input id="q" placeholder="Поиск: название, продукт, тег…" value="${esc(filters.q)}">
      <div class="chips" style="margin-top:8px">
        <button class="chip ${!filters.type ? 'on' : ''}" data-type="">Все</button>
        ${usedTypes.map(t => `<button class="chip ${filters.type === t ? 'on' : ''}" data-type="${t}">${t}</button>`).join('')}
      </div>
      <div class="chips">
        <button class="chip ${filters.have ? 'on' : ''}" id="haveF">🧺 Всё есть</button>
      </div>
      <div class="chips">
        <button class="chip ${!filters.cuisine ? 'on' : ''}" data-cuisine="">🌍 Все кухни</button>
        ${cuisines.map(c => `<button class="chip ${filters.cuisine === c ? 'on' : ''}" data-cuisine="${esc(c)}">${esc(c)}</button>`).join('')}
      </div>
      <div class="chips">
        ${[1, 2, 3].map(d => `<button class="chip ${filters.diff === d ? 'on' : ''}" data-diff="${d}">${diffDots(d)} ${DIFF[d]}</button>`).join('')}
        ${[20, 30, 45].map(t => `<button class="chip ${filters.maxTime === t ? 'on' : ''}" data-time="${t}">≤ ${t} мин</button>`).join('')}
      </div>
      ${filters.have ? `<div class="muted small" style="margin:2px 0 6px">Сначала то, на что всё есть, дальше по числу недостающих продуктов. Соль, масло и «по желанию» не считаются.</div>` : ''}
      ${filters.have && list.length ? (() => { const word = n => n === 0 ? '✓ Всё есть' : `Не хватает ${n} ${n === 1 ? 'продукта' : 'продуктов'}`; let prev = -1; return list.map(r => { const n = missing(r).length; const h = n !== prev ? `<h2 style="margin:16px 0 4px;font-size:15px;color:${n ? 'var(--accent)' : 'var(--ok)'}">${word(n)}</h2>` : ''; prev = n; return h + rCard(r); }).join(''); })() : list.length ? list.map(rCard).join('') : filters.have ? `<div class="empty"><div class="big">🧺</div>Склад пустой — отметь, что есть дома, во вкладке «Склад».</div>` : `<div class="empty"><div class="big">🤷</div>Ничего не нашлось. Сам виноват, фильтры твои.</div>`}
      <button class="btn full" id="newRecipe" style="margin-top:12px">＋ Новый рецепт</button>`;
  },
  bind() {
    const q = $('#q');
    q.oninput = () => { filters.q = q.value; const pos = q.selectionStart; render(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
    document.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { filters.type = b.dataset.type; render(); });
    $('#haveF').onclick = () => { filters.have = !filters.have; render(); };
    document.querySelectorAll('[data-cuisine]').forEach(b => b.onclick = () => { filters.cuisine = b.dataset.cuisine; render(); });
    document.querySelectorAll('[data-diff]').forEach(b => b.onclick = () => { const d = +b.dataset.diff; filters.diff = filters.diff === d ? 0 : d; render(); });
    document.querySelectorAll('[data-time]').forEach(b => b.onclick = () => { const t = +b.dataset.time; filters.maxTime = filters.maxTime === t ? 0 : t; render(); });
    document.querySelectorAll('[data-rid]').forEach(b => b.onclick = () => go('recipe', b.dataset.rid));
    $('#newRecipe').onclick = () => go('edit', null);
  }
};
function rCard(r) {
  return `<div class="card"><button class="rcard" data-rid="${r.id}">
    <div class="em">${esc(r.emoji)}</div>
    <div class="grow"><div class="t">${esc(r.title)}</div>
      <div class="badges">
        <span class="b type">${esc(r.type)}</span>
        ${r.cuisine ? `<span class="b">${esc(r.cuisine)}</span>` : ''}
        <span class="b">⏱ ${fmtDur(r.time)}</span>
        <span class="b">🔥 ${r.kcal}${hasVars(r) && r.pick_one ? '+' : ''} ккал</span>
        <span class="b diff" title="${DIFF[r.difficulty]}">${diffDots(r.difficulty)}</span>
      </div>${filters.have ? (m => `<div class="small" style="margin-top:4px;color:${m.length ? 'var(--accent)' : 'var(--ok)'}">${m.length ? 'не хватает: ' + esc(m.join(', ')) : '✓ всё есть'}</div>`)(missing(r)) : ''}</div></button></div>`;
}

/* ================= Экран: рецепт ================= */
/* Вариант может нести свои шаги (паэлья, ризотто) — тогда они заменяют общие */
const effSteps = (r, vars) => { const v = (vars || []).map(i => (r.variants || [])[i]).find(v => v && v.steps && v.steps.length); return v ? v.steps : r.steps; };
const recipeUI = {}; // id -> {servings, done:Set, vars}
VIEWS.recipe = {
  title: id => (getRecipe(id) || {}).title || 'Рецепт',
  html(id) {
    const r = getRecipe(id);
    if (!r) return `<div class="empty">Рецепт исчез. Бывает.</div>`;
    const ui = recipeUI[id] = recipeUI[id] || { servings: r.servings, done: new Set(), vars: defaultVars(r) };
    ui.vars = cleanVars(r, ui.vars);
    const k = ui.servings / r.servings;
    const ing = effIng(r, ui.vars);
    const main = ing.filter(i => !ingOpt(i).opt), opt = ing.filter(i => ingOpt(i).opt);
    const nut = effNut(r, ui.vars);
    const li = i => {
      const o = ingOpt(i), hv = haveAny(canon(ingName(i)));
      return `<li><span>${esc(ingName(i))}${hv ? '<span class="have">✓ есть</span>' : ''}${o.note ? `<br><span class="muted small">${esc(o.note)}</span>` : ''}</span><span class="amt">${esc(fmtAmt(ingAmt(i) * k, ingUnit(i)))}</span></li>`;
    };
    const steps = effSteps(r, ui.vars);
    const varNotes = ui.vars.map(i => r.variants[i]).filter(v => v.note).map(v => `<div class="note" style="margin-top:8px"><b>${esc(v.name)}:</b> ${esc(v.note)}</div>`).join('');
    return `
      <div class="row" style="gap:14px;margin-top:4px">
        <div style="font-size:56px">${esc(r.emoji)}</div>
        <div class="grow"><div class="badges">
          <span class="b type">${esc(r.type)}</span>${r.cuisine ? `<span class="b">${esc(r.cuisine)}</span>` : ''}<span class="b">⏱ ${fmtDur(r.time)}</span>
          <span class="b diff">${diffDots(r.difficulty)} ${DIFF[r.difficulty]}</span>
          ${r.tags.map(t => `<span class="b">#${esc(t)}</span>`).join('')}
        </div></div>
      </div>
      ${r.desc ? `<p class="muted">${esc(r.desc)}</p>` : ''}
      ${hasVars(r) ? `<div class="card"><h3 style="margin-top:0">${r.pick_one ? 'Вариант' : 'Добавки по желанию'}</h3>${varChips(r, ui.vars, 'data-var')}${varNotes}</div>` : ''}
      <div class="stats">
        <div class="stat"><b>${nut.kcal}</b><span>ккал/порц</span></div>
        <div class="stat"><b>${nut.p}</b><span>белки, г</span></div>
        <div class="stat"><b>${nut.f}</b><span>жиры, г</span></div>
        <div class="stat"><b>${nut.c}</b><span>углев., г</span></div>
      </div>
      <button class="btn pri full" id="toPlan">📅 Добавить в план</button>
      ${(r.tips || []).map(t => `<div class="note" style="margin-top:10px"><b>${esc(t[0])}.</b> ${esc(t[1])}</div>`).join('')}
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <h3 style="margin:0">Продукты</h3>
          <div class="serv"><button id="sMinus">−</button><b>${ui.servings}</b><span class="muted small">порц.</span><button id="sPlus">＋</button></div>
        </div>
        <ul class="ing">${main.map(li).join('')}</ul>
        ${opt.length ? `<h3>По желанию</h3><ul class="ing">${opt.map(li).join('')}</ul>` : ''}
      </div>
      <div class="card">
        <h3 style="margin-top:0">Шаги <span class="muted small">— тапни номер, чтобы отметить</span></h3>
        ${steps.map((s, n) => `
          <div class="step ${ui.done.has(n) ? 'done' : ''}">
            <button class="n" data-step="${n}">${ui.done.has(n) ? '✓' : n + 1}</button>
            <div class="st grow"><b>${esc(s[0])}</b>${esc(s[1])}
              ${s[2] ? `<div><button class="tbtn" data-timer="${n}">⏱ ${fmtTime(s[2])} — запустить</button></div>` : ''}
            </div>
          </div>`).join('')}
      </div>
      ${r.notes ? `<div class="note">💡 ${esc(r.notes)}</div>` : ''}
      ${r.src && r.src.length ? `<div class="card"><h3 style="margin-top:0">Источники</h3>${r.src.map(s => `<div class="small"><a href="${esc(s[1])}" target="_blank" rel="noopener" style="color:var(--accent)">${esc(s[0])}</a></div>`).join('')}</div>` : ''}
      <div class="row" style="margin-top:16px">
        <button class="btn grow" id="editR">✏️ Изменить</button>
        <button class="btn danger" id="delR">🗑 Удалить</button>
      </div>`;
  },
  bind(id) {
    const r = getRecipe(id); if (!r) return;
    const ui = recipeUI[id];
    $('#sMinus').onclick = () => { ui.servings = Math.max(1, ui.servings - 1); render(); };
    $('#sPlus').onclick = () => { ui.servings = Math.min(20, ui.servings + 1); render(); };
    document.querySelectorAll('[data-var]').forEach(b => b.onclick = () => { const had = effSteps(r, ui.vars); ui.vars = toggleVar(r, ui.vars, +b.dataset.var); if (effSteps(r, ui.vars) !== had) ui.done.clear(); render(); });
    document.querySelectorAll('[data-step]').forEach(b => b.onclick = () => { const n = +b.dataset.step; ui.done.has(n) ? ui.done.delete(n) : ui.done.add(n); render(); });
    document.querySelectorAll('[data-timer]').forEach(b => b.onclick = () => { const s = effSteps(r, ui.vars)[+b.dataset.timer]; startTimer(`${r.title}: ${s[0]}`, s[2]); });
    $('#toPlan').onclick = () => planSheet(id, { vars: ui.vars });
    $('#editR').onclick = () => go('edit', id);
    $('#delR').onclick = () => confirmSheet(`Удалить «${r.title}»?`, 'Из плана он тоже пропадёт.', () => {
      if (window.SEED_RECIPES.some(x => x.id === id)) { S.deleted[id] = true; mark('d:' + id); }
      delete S.recipes[id]; mark('r:' + id);
      for (const d in S.plan) S.plan[d] = S.plan[d].filter(e => { if (e.rid === id) { mark('e:' + e.id); return false; } return true; });
      save(); back(); toast('Удалено');
    });
  }
};

/* ================= Экран: редактор ================= */
VIEWS.edit = {
  title: id => id ? 'Правка рецепта' : 'Новый рецепт',
  html(id) {
    const r = id ? getRecipe(id) : normRecipe({ title: '', servings: 2 });
    const ingTxt = r.ing.map(i => { const o = ingOpt(i); return [ingName(i), ingAmt(i) || '', ingUnit(i), o.opt ? 'опц' : (o.staple ? 'база' : '')].filter((x, n) => n < 3 || x).join(' | '); }).join('\n');
    const stTxt = r.steps.map(s => [s[0], s[1], s[2] ? Math.round(s[2] / 60 * 10) / 10 : ''].join(' | ')).join('\n');
    return `
      <label class="f">Название</label><input id="eTitle" value="${esc(r.title)}">
      <div class="row">
        <div style="width:80px"><label class="f">Эмодзи</label><input id="eEmoji" value="${esc(r.emoji)}"></div>
        <div class="grow"><label class="f">Тип</label><select id="eType">${TYPES.map(t => `<option ${t === r.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      </div>
      <div class="row">
        <div class="grow"><label class="f">Сложность</label><select id="eDiff">${[1, 2, 3].map(d => `<option value="${d}" ${d === r.difficulty ? 'selected' : ''}>${DIFF[d]}</option>`).join('')}</select></div>
        <div class="grow"><label class="f">Время, мин</label><input id="eTime" type="number" inputmode="numeric" value="${r.time}"></div>
        <div class="grow"><label class="f">Порций</label><input id="eServ" type="number" inputmode="numeric" value="${r.servings}"></div>
      </div>
      <label class="f">КБЖУ на порцию: ккал / белки / жиры / углеводы</label>
      <div class="row"><input id="eK" type="number" value="${r.kcal}"><input id="eP" type="number" value="${r.p}"><input id="eF" type="number" value="${r.f}"><input id="eC" type="number" value="${r.c}"></div>
      <label class="f">Описание</label><textarea id="eDesc" style="min-height:70px">${esc(r.desc)}</textarea>
      <label class="f">Теги через запятую</label><input id="eTags" value="${esc(r.tags.join(', '))}">
      <label class="f">Продукты, по строке: <b>название | кол-во | ед. | опц/база</b></label>
      <textarea id="eIng" placeholder="Творог | 400 | г&#10;Соль | 1 | ч.л. | база&#10;Сметана | 100 | г | опц">${esc(ingTxt)}</textarea>
      <label class="f">Шаги, по строке: <b>заголовок | что делать | таймер, мин</b></label>
      <textarea id="eSteps" style="min-height:160px" placeholder="Обжарить | Жарь до корочки | 4">${esc(stTxt)}</textarea>
      <label class="f">Заметки</label><textarea id="eNotes" style="min-height:60px">${esc(r.notes)}</textarea>
      <button class="btn pri full" id="eSave" style="margin-top:14px">Сохранить</button>`;
  },
  bind(id) {
    $('#eSave').onclick = () => {
      const title = $('#eTitle').value.trim();
      if (!title) return toast('Без названия? Серьёзно?');
      const ing = $('#eIng').value.split('\n').map(l => l.split('|').map(x => x.trim())).filter(p => p[0]).map(p => {
        const o = {}; if (/^опц/i.test(p[3] || '')) o.opt = true; if (/^баз/i.test(p[3] || '')) o.staple = true;
        const row = [p[0], parseFloat((p[1] || '').replace(',', '.')) || 0, p[2] || ''];
        if (o.opt || o.staple) row.push(o);
        return row;
      });
      const steps = $('#eSteps').value.split('\n').map(l => l.split('|').map(x => x.trim())).filter(p => p[0]).map(p =>
        [p[0], p[1] || '', Math.round((parseFloat((p[2] || '').replace(',', '.')) || 0) * 60)]);
      const rid = id || ('u-' + uid());
      S.recipes[rid] = {
        ...(id ? getRecipe(id) : {}),
        id: rid, title, emoji: $('#eEmoji').value.trim() || '🍽', type: $('#eType').value,
        difficulty: +$('#eDiff').value, time: +$('#eTime').value || 0, servings: Math.max(1, +$('#eServ').value || 1),
        kcal: +$('#eK').value || 0, p: +$('#eP').value || 0, f: +$('#eF').value || 0, c: +$('#eC').value || 0,
        desc: $('#eDesc').value.trim(), tags: $('#eTags').value.split(',').map(t => t.trim()).filter(Boolean),
        ing, steps, notes: $('#eNotes').value.trim(), edited: true,
      };
      delete recipeUI[rid]; mark('r:' + rid);
      save(); stack.pop();
      if (!id) stack.push({ view: 'recipe', arg: rid });
      render(); toast('Сохранено');
    };
  }
};

/* ================= Экран: план ================= */
let planDay = iso(new Date());
/* 3 дня назад (дописать/отметить съеденное) + сегодня + 6 вперёд */
const PAST_DAYS = 3;
function week() { return Array.from({ length: 7 + PAST_DAYS }, (_, n) => iso(addDays(new Date(), n - PAST_DAYS))); }
const prof = id => S.profiles.find(p => p.id === id) || S.profiles[0];
const meP = () => prof(S.me || S.profiles[0].id);
function cookOf(d) { return S.cookOverride[d] || S.cook[new Date(d + 'T12:00:00').getDay()] || S.profiles[0].id; }
function splitOf(e) { return e.split || Object.fromEntries(S.profiles.map(p => [p.id, p.share])); }
const SPLITS = () => { const [a, b] = S.profiles; return [
  ['по умолчанию', null], ['50/50', { [a.id]: 50, [b.id]: 50 }], ['только ' + a.name, { [a.id]: 100, [b.id]: 0 }], ['только ' + b.name, { [a.id]: 0, [b.id]: 100 }]]; };
// калории одного человека от записи плана
function entryKcal(e, r, pid) { const sp = splitOf(e), tot = Object.values(sp).reduce((x, y) => x + y, 0) || 1; return effNut(r, e.vars).kcal * e.portions * (sp[pid] || 0) / tot; }
function dayTotals(d) {
  const out = {};
  for (const p of S.profiles) out[p.id] = { kcal: 0, p: 0, f: 0, c: 0 };
  for (const e of S.plan[d] || []) {
    const r = getRecipe(e.rid); if (!r) continue;
    const sp = splitOf(e), tot = Object.values(sp).reduce((x, y) => x + y, 0) || 1, n = effNut(r, e.vars);
    for (const p of S.profiles) { const k = e.portions * (sp[p.id] || 0) / tot; for (const x of ['kcal', 'p', 'f', 'c']) out[p.id][x] += n[x] * k; }
  }
  for (const id in out) for (const x in out[id]) out[id][x] = Math.round(out[id][x]);
  return out;
}
function bars(d) {
  const t = dayTotals(d);
  return S.profiles.map(p => { const v = t[p.id], left = p.goal - v.kcal; return `
    <div style="margin-top:8px"><div class="row small" style="justify-content:space-between"><span><b>${esc(p.name)}</b>${p.id === S.me ? ' <span class="muted">(я)</span>' : ''}</span><span><b>${v.kcal}</b> / ${p.goal} ккал</span></div>
    <div class="bar ${v.kcal > p.goal ? 'over' : ''}"><div style="width:${Math.min(100, v.kcal / p.goal * 100)}%"></div></div>
    <div class="row small" style="justify-content:space-between"><span class="muted">Б ${v.p} · Ж ${v.f} · У ${v.c}</span><span style="color:${left < 0 ? 'var(--bad)' : 'var(--ok)'}">${left >= 0 ? 'ещё ' + left : 'перебор ' + (-left)}</span></div></div>`; }).join('');
}
VIEWS.plan = {
  title: 'План на неделю',
  html() {
    const days = week();
    const today = iso(new Date()); if (!days.includes(planDay)) planDay = today;
    const entries = S.plan[planDay] || [];
    const ck = prof(cookOf(planDay));
    return `
      <div class="week">${days.map(d => {
        const dt = new Date(d + 'T12:00:00');
        return `<button class="day ${d === planDay ? 'on' : ''} ${(S.plan[d] || []).length ? 'has' : ''} ${d < today ? 'past' : ''}" data-day="${d}">${WD[dt.getDay()]}<b>${dt.getDate()}</b><span class="ck">${esc(prof(cookOf(d)).name[0])}</span><i></i></button>`;
      }).join('')}</div>
      <div class="card">
        <div class="row" style="justify-content:space-between"><b>${dayLabel(planDay)}</b><button class="chip" id="cookBtn">👨‍🍳 готовит ${esc(ck.name)}${S.cookOverride[planDay] ? ' ✎' : ''}</button></div>
        ${bars(planDay)}
        ${planDay < today ? '<div class="small" style="margin-top:6px;color:var(--accent)">Прошедший день. Добавь, что ели, и жми ✓ — продукты спишутся со склада.</div>' : ''}
        ${entries.length ? '' : '<div class="small muted" style="margin-top:6px">Пусто. Голодать не планировали?</div>'}
      </div>
      ${SLOTS.map(slot => {
        const es = entries.filter(e => e.slot === slot);
        return `<div class="card slot"><h3 style="margin:0 0 4px">${slot}<button class="btn sm" data-add="${slot}">＋</button></h3>
          ${es.map(e => { const r = getRecipe(e.rid); if (!r) return ''; return `
            <div class="pe">
              <span class="em">${esc(r.emoji)}</span>
              <button class="grow" style="text-align:left" data-open="${r.id}"><div style="${e.done ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(r.title)}</div>
                ${hasVars(r) && cleanVars(r, e.vars).length ? `<div class="small" style="color:var(--accent)">${esc(varLabel(r, e.vars))}</div>` : ''}<div class="muted small">${e.portions} порц. · ${S.profiles.map(p => esc(p.name[0]) + ' ' + Math.round(entryKcal(e, r, p.id))).join(' / ')} ккал${e.split ? ' · ' + S.profiles.map(p => e.split[p.id]).join('/') : ''}</div></button>
              <button class="btn sm" data-cook="${e.id}" title="Приготовлено">${e.done ? '↺' : '✓'}</button>
              <button class="btn sm" data-edit="${e.id}">⋯</button>
            </div>`; }).join('') || '<div class="muted small">—</div>'}
        </div>`;
      }).join('')}
      <button class="btn full" id="goShop" style="margin-top:6px">🛒 Что заказать</button>`;
  },
  bind() {
    document.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { planDay = b.dataset.day; render(); });
    { // лента дней: по умолчанию сегодня — первым, прошлые дни — свайпом влево
      const w = $('.week'), today = iso(new Date()), anchor = w && w.querySelector(`[data-day="${planDay < today ? planDay : today}"]`);
      if (anchor) w.scrollLeft = anchor.offsetLeft - w.offsetLeft;
    }
    document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => pickRecipeSheet(planDay, b.dataset.add));
    document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => go('recipe', b.dataset.open));
    document.querySelectorAll('[data-cook]').forEach(b => b.onclick = () => toggleCooked(planDay, b.dataset.cook));
    document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => entrySheet(planDay, b.dataset.edit));
    $('#goShop').onclick = () => setTab('shop');
    $('#cookBtn').onclick = () => {
      const cur = cookOf(planDay), base = S.cook[new Date(planDay + 'T12:00:00').getDay()];
      const next = S.profiles.find(p => p.id !== cur).id;
      if (next === base) delete S.cookOverride[planDay]; else S.cookOverride[planDay] = next;
      mark('co:' + planDay); save(); render(); toast(`${dayLabel(planDay)} готовит ${prof(next).name}`);
    };
  }
};
function toggleCooked(d, eid) {
  const e = (S.plan[d] || []).find(x => x.id === eid); if (!e) return;
  e.done = !e.done; mark('e:' + e.id);
  if (e.done) {
    const r = getRecipe(e.rid); const used = [];
    const k = r ? e.portions / (r.servings || 1) : 1;
    if (r) for (const i of effIng(r, e.vars)) {
      const o = ingOpt(i), n = canon(ingName(i));
      if (o.staple || BASE.has(n)) continue;
      if (QTY.has(n)) { // бульон: списываем порции, при нехватке родного — заменитель
        const src = subOf(n); if (!src) continue;
        const take = Math.min(portionsOf(i, k), qty(src)); addQty(src, -take);
        used.push(`${src} −${take} порц.${qty(src) ? ` (осталось ${qty(src)})` : ''}`); continue;
      }
      if (have(n) && (!o.opt || catOf(n) === 'Готовое дома')) { setHave(n, false); used.push(n); } /* домашние заготовки тратятся, даже если «по желанию» */
    }
    // побочные продукты и заготовки — на склад. yields: 'Имя' или ['Имя', порций]
    const ys = r ? [...(r.yields || []), ...cleanVars(r, e.vars).flatMap(i => r.variants[i].yields || [])] : [];
    const got = [];
    for (const y of ys) {
      const [n, c] = Array.isArray(y) ? y : [y, null];
      if (QTY.has(n)) { const add = r.type === 'заготовка' ? (c || 4) : Math.max(1, Math.round((c || 4) * k)); addQty(n, add); /* заготовка — всегда целая кастрюля */ got.push(`${n} +${add} порц.`); }
      else if (!got.includes(n)) { setHave(n, true); got.push(n); }
    }
    toast([used.length ? `Списал со склада: ${used.join(', ')}` : 'Отмечено как приготовленное', got.length ? `На складе: ${got.join(', ')} 🍲` : ''].filter(Boolean).join('. '));
  }
  save(); render();
}

/* ================= Экран: покупки ================= */
function shoppingList() {
  const days = Array.from({ length: S.settings.shopDays }, (_, n) => iso(addDays(new Date(), n)));
  const agg = {};
  for (const d of days) for (const e of S.plan[d] || []) {
    if (e.done) continue;
    const r = getRecipe(e.rid); if (!r) continue;
    const k = e.portions / r.servings;
    for (const i of effIng(r, e.vars)) {
      const o = ingOpt(i), n = canon(ingName(i)), u = ingUnit(i), key = n + '|' + u;
      const a = agg[key] = agg[key] || { name: n, unit: u, amt: 0, opt: true, staple: !!o.staple, from: new Set() };
      a.amt += ingAmt(i) * k; a.opt = a.opt && !!o.opt; a.from.add(r.title);
    }
  }
  // объединяем одинаковые продукты с разными единицами в одну строку
  const byName = {};
  for (const a of Object.values(agg)) {
    const b = byName[a.name] = byName[a.name] || { name: a.name, parts: [], opt: true, staple: false, from: new Set() };
    b.parts.push(fmtAmt(a.amt, a.unit)); b.opt = b.opt && a.opt; b.staple = b.staple || a.staple; a.from.forEach(f => b.from.add(f));
  }
  return { items: Object.values(byName), days };
}
VIEWS.shop = {
  title: 'Список покупок',
  html() {
    const { items } = shoppingList();
    const need = items.filter(i => !i.opt && !haveAny(i.name));
    const got = items.filter(i => haveAny(i.name));
    const opt = items.filter(i => i.opt && !haveAny(i.name));
    const groups = {};
    need.forEach(i => (groups[catOf(i.name)] = groups[catOf(i.name)] || []).push(i));
    const row = (i, on) => `<div class="item ${on ? 'off' : ''}" data-toggle="${esc(i.name)}">
        <div class="cb ${on ? 'on' : ''}">${on ? '✓' : ''}</div>
        <div class="grow"><div class="nm">${esc(i.name)}</div><div class="muted small">${esc([...i.from].join(', '))}</div></div>
        <div class="q">${esc(i.parts.join(' + '))}</div></div>`;
    return `
      <div class="chips">${[1, 2, 3, 7].map(n => `<button class="chip ${S.settings.shopDays === n ? 'on' : ''}" data-days="${n}">${n === 1 ? 'На сегодня' : n === 7 ? 'На неделю' : `На ${n} дня`}</button>`).join('')}</div>
      ${!items.length && !S.extras.length ? `<div class="empty"><div class="big">🛒</div>План пустой, значит и покупать нечего.<br><br><button class="btn pri" id="toPlan2">Открыть план</button></div>` : `
      <div class="card">
        <div class="row" style="justify-content:space-between"><h3 style="margin:0">Купить · ${need.length + S.extras.filter(x => !x.done).length}</h3>
        <button class="btn sm" id="copy">📋 Копировать</button></div>
        <div class="muted small">Тапни, если продукт уже есть или куплен: он уйдёт на склад.</div>
        ${Object.keys(groups).sort().map(c => `<div class="cat">${c}</div>${groups[c].map(i => row(i, false)).join('')}`).join('') || (S.extras.length ? '' : '<div class="muted" style="padding:10px 0">Всё есть. Можно ничего не заказывать 🎉</div>')}
        ${S.extras.length ? `<div class="cat">Добавлено вручную</div>${S.extras.map((x, n) => `<div class="item ${x.done ? 'off' : ''}"><div class="cb ${x.done ? 'on' : ''}" data-extra="${n}">${x.done ? '✓' : ''}</div><div class="grow nm" data-extra="${n}">${esc(x.name)}</div><button class="btn sm" data-rmextra="${n}">✕</button></div>`).join('')}` : ''}
        <div class="row" style="margin-top:10px"><input id="extraIn" placeholder="Добавить что-то ещё…"><button class="btn" id="extraAdd">＋</button></div>
      </div>
      ${opt.length ? `<div class="card"><h3 style="margin-top:0">По желанию</h3>${opt.map(i => row(i, false)).join('')}</div>` : ''}
      ${got.length ? `<div class="card"><h3 style="margin-top:0">Уже есть дома · ${got.length}</h3>${got.map(i => row(i, true)).join('')}</div>` : ''}
      `}`;
  },
  bind() {
    document.querySelectorAll('[data-days]').forEach(b => b.onclick = () => { S.settings.shopDays = +b.dataset.days; save(); render(); });
    document.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => { const n = b.dataset.toggle; setHave(n, !have(n)); save(); render(); });
    document.querySelectorAll('[data-extra]').forEach(b => b.onclick = () => { const x = S.extras[+b.dataset.extra]; x.done = !x.done; mark('x:' + x.id); save(); render(); });
    document.querySelectorAll('[data-rmextra]').forEach(b => b.onclick = () => { const [x] = S.extras.splice(+b.dataset.rmextra, 1); mark('x:' + x.id); save(); render(); });
    const add = () => { const v = $('#extraIn').value.trim(); if (v) { const x = { id: uid(), name: v, done: false }; S.extras.push(x); mark('x:' + x.id); save(); render(); } };
    if ($('#extraAdd')) { $('#extraAdd').onclick = add; $('#extraIn').onkeydown = e => e.key === 'Enter' && add(); }
    if ($('#toPlan2')) $('#toPlan2').onclick = () => setTab('plan');
    if ($('#copy')) $('#copy').onclick = () => {
      const { items } = shoppingList();
      const need = items.filter(i => !i.opt && !haveAny(i.name));
      const groups = {}; need.forEach(i => (groups[catOf(i.name)] = groups[catOf(i.name)] || []).push(i));
      let txt = Object.keys(groups).sort().map(c => `${c}:\n` + groups[c].map(i => `— ${i.name}: ${i.parts.join(' + ')}`).join('\n')).join('\n\n');
      const ex = S.extras.filter(x => !x.done).map(x => `— ${x.name}`);
      if (ex.length) txt += (txt ? '\n\n' : '') + 'Ещё:\n' + ex.join('\n');
      copyText(txt || 'Ничего не надо');
    };
  }
};
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Скопировано'); }
  catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); toast('Скопировано'); } catch (_) { toast('Не вышло скопировать'); } a.remove(); }
}

/* ================= Экран: склад ================= */
let pantryQ = '';
function allProducts() {
  const set = new Set(S.customProducts);
  for (const r of allRecipes()) for (const i of r.ing) set.add(canon(ingName(i)));
  for (const n in S.pantry) if (S.pantry[n]) set.add(n);
  return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
}
VIEWS.pantry = {
  title: 'Склад',
  html() {
    const q = pantryQ.toLowerCase();
    const ps = allProducts().filter(p => !q || p.toLowerCase().includes(q));
    const yes = ps.filter(p => have(p)), not = ps.filter(p => !have(p));
    const row = p => QTY.has(p)
      ? `<div class="item" data-qp="${esc(p)}"><div class="cb ${have(p) ? 'on' : ''}" style="width:auto;min-width:26px;padding:0 4px">${qty(p) || ''}</div><div class="grow">${esc(p)}<br><span class="muted small">${qty(p) ? `${qty(p)} порц. по 250 мл ≈ ${(qty(p) * PORTION_ML / 1000).toLocaleString('ru')} л` : 'порции по 250 мл (кубик концентрата)'}</span></div>${have(p) ? `<button class="btn sm" data-find="${esc(p)}" title="Что приготовить">🔍</button><button class="btn sm" data-dq="${esc(p)}">−</button>` : ''}<button class="btn sm" data-iq="${esc(p)}">＋</button></div>`
      : `<div class="item" data-p="${esc(p)}"><div class="cb ${have(p) ? 'on' : ''}">${have(p) ? '✓' : ''}</div><div class="grow">${esc(p)}</div>${have(p) ? `<button class="btn sm" data-find="${esc(p)}" title="Что приготовить">🔍</button>` : ''}${S.customProducts.includes(p) ? `<button class="btn sm" data-rm="${esc(p)}">✕</button>` : ''}</div>`;
    return `
      <div class="row"><input id="pq" placeholder="Найти или добавить продукт…" value="${esc(pantryQ)}"><button class="btn" id="padd">＋</button></div>
      <p class="muted small">Отмеченное считается «есть дома» и не попадает в список покупок. «Приготовлено» в плане списывает продукты (кроме соли и прочей базы) и кладёт на склад то, что осталось, например бульон. Бульоны считаются порциями по 250 мл (кубик концентрата = порция), ＋/− правят руками. 🔍 — что приготовить из продукта.</p>
      <div class="card"><h3 style="margin-top:0">Есть дома · ${yes.length}</h3>${yes.map(row).join('') || '<div class="muted small">Пусто. Холодильник плачет.</div>'}</div>
      <div class="card"><h3 style="margin-top:0">Нет · ${not.length}</h3>${(() => { const g = {}; not.forEach(x => (g[catOf(x)] = g[catOf(x)] || []).push(x)); return Object.keys(g).sort((a, b) => a.localeCompare(b, 'ru')).map(c => `<div class="cat">${esc(c)}</div>${g[c].map(row).join('')}`).join(''); })() || '<div class="muted small">—</div>'}</div>`;
  },
  bind() {
    const pq = $('#pq');
    pq.oninput = () => { pantryQ = pq.value; const pos = pq.selectionStart; render(); const n = $('#pq'); n.focus(); n.setSelectionRange(pos, pos); };
    const add = () => { const v = pq.value.trim(); if (!v) return; if (!S.customProducts.includes(v) && !allProducts().includes(v)) { S.customProducts.push(v); mark('cp:' + v); } setHave(v, true); pantryQ = ''; save(); render(); toast(`«${v}» есть дома`); };
    $('#padd').onclick = add; pq.onkeydown = e => e.key === 'Enter' && add();
    document.querySelectorAll('[data-find]').forEach(b => b.onclick = () => { Object.assign(filters, { q: b.dataset.find, type: '', cuisine: '', diff: 0, maxTime: 0, have: false }); setTab('recipes'); toast(`Рецепты, где есть «${b.dataset.find}»`); });
    document.querySelectorAll('[data-p]').forEach(b => b.onclick = ev => { if (ev.target.closest('[data-rm],[data-find]')) return; const p = b.dataset.p; setHave(p, !have(p)); save(); render(); });
    document.querySelectorAll('[data-iq]').forEach(b => b.onclick = () => { addQty(b.dataset.iq, 1); save(); render(); });
    document.querySelectorAll('[data-dq]').forEach(b => b.onclick = () => { addQty(b.dataset.dq, -1); save(); render(); });
    document.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { const p = b.dataset.rm; S.customProducts = S.customProducts.filter(x => x !== p); mark('cp:' + p); setHave(p, false); save(); render(); });
  }
};

/* ================= Шторки ================= */
function openSheet(html, bind) {
  const sh = $('#sheet'); $('.sheet-body', sh).innerHTML = html; sh.classList.remove('hidden');
  $('.sheet-bg', sh).onclick = closeSheet; bind && bind($('.sheet-body', sh));
}
function closeSheet() { $('#sheet').classList.add('hidden'); }
function confirmSheet(title, text, ok) {
  openSheet(`<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p><div class="row"><button class="btn grow" id="cNo">Отмена</button><button class="btn pri grow" id="cYes">Да</button></div>`,
    () => { $('#cNo').onclick = closeSheet; $('#cYes').onclick = () => { closeSheet(); ok(); }; });
}
function addEntry(day, e) { e.id = e.id || uid(); e.date = day; (S.plan[day] = S.plan[day] || []).push(e); mark('e:' + e.id); }
function planSheet(rid, preset = {}) {
  const r = getRecipe(rid);
  let day = preset.day || planDay;
  let slot = preset.slot || SLOTS.find(s => s.toLowerCase() === r.type) || (r.type === 'завтрак' ? 'Завтрак' : 'Ужин');
  let portions = S.settings.people;
  let vars = cleanVars(r, preset.vars || defaultVars(r));
  const draw = () => {
    const e = { portions, vars };
    openSheet(`
    <h2>${esc(r.emoji)} ${esc(r.title)} — в план</h2>
    ${hasVars(r) ? `<label class="f">${r.pick_one ? 'Вариант' : 'Добавки по желанию'}</label>${varChips(r, vars, 'data-v')}` : ''}
    <label class="f">День</label><div class="chips">${week().map(d => `<button class="chip ${d === day ? 'on' : ''}" data-d="${d}">${dayLabel(d)} · ${esc(prof(cookOf(d)).name[0])}</button>`).join('')}</div>
    <label class="f">Приём пищи</label><div class="chips">${SLOTS.map(s => `<button class="chip ${s === slot ? 'on' : ''}" data-s="${s}">${s}</button>`).join('')}</div>
    <label class="f">Сколько порций готовим</label>
    <div class="serv"><button id="pm">−</button><b>${portions}</b><span class="muted small">${S.profiles.map(p => esc(p.name) + ' ≈ ' + Math.round(entryKcal(e, r, p.id))).join(', ')} ккал</span><button id="pp">＋</button></div>
    <button class="btn pri full" id="pOk" style="margin-top:16px">Добавить</button>`, () => {
      document.querySelectorAll('#sheet [data-v]').forEach(b => b.onclick = () => { vars = toggleVar(r, vars, +b.dataset.v); draw(); });
      document.querySelectorAll('#sheet [data-d]').forEach(b => b.onclick = () => { day = b.dataset.d; draw(); });
      document.querySelectorAll('#sheet [data-s]').forEach(b => b.onclick = () => { slot = b.dataset.s; draw(); });
      $('#pm').onclick = () => { portions = Math.max(1, portions - 1); draw(); };
      $('#pp').onclick = () => { portions++; draw(); };
      $('#pOk').onclick = () => { addEntry(day, { rid, slot, portions, vars, done: false }); save(); closeSheet(); toast(`${dayLabel(day)}, ${slot.toLowerCase()}: добавлено`); render(); };
    });
  };
  draw();
}
function pickRecipeSheet(day, slot) {
  const me = meP(), left = me.goal - dayTotals(day)[me.id].kcal;
  const share = me.share / S.profiles.reduce((x, p) => x + p.share, 0); // доля моей порции
  const pref = { 'Завтрак': ['завтрак'], 'Обед': ['первое', 'второе', 'салат', 'гарнир'], 'Ужин': ['второе', 'гарнир', 'салат'], 'Перекус': ['перекус', 'десерт', 'напиток', 'салат'] }[slot] || [];
  const rs = allRecipes().sort((a, b) => (pref.includes(b.type) - pref.includes(a.type)) || a.title.localeCompare(b.title, 'ru'));
  let q = '';
  const mine = r => Math.round(r.kcal * S.settings.people * share);
  const list = () => rs.filter(r => !q || (r.title + ' ' + (r.cuisine || '')).toLowerCase().includes(q)).map(r => `<div class="item" data-pick="${r.id}"><span style="font-size:26px">${esc(r.emoji)}</span><div class="grow">${esc(r.title)}<div class="muted small">${esc(r.type)} · ${esc(r.cuisine || '')} · ${fmtDur(r.time)} · тебе ≈${mine(r)}${hasVars(r) && r.pick_one ? '+' : ''} ккал</div></div>${missing(r).length === 0 ? '<span title="всё есть дома">🧺</span>' : ''}${mine(r) <= left ? '<span style="color:var(--ok)">✓</span>' : ''}</div>`).join('');
  const bindList = () => document.querySelectorAll('#sheet [data-pick]').forEach(b => b.onclick = () => {
    const r = getRecipe(b.dataset.pick);
    if (hasVars(r)) return planSheet(r.id, { day, slot });
    addEntry(day, { rid: r.id, slot, portions: S.settings.people, vars: [], done: false });
    save(); closeSheet(); render();
  });
  openSheet(`<h2>${slot} · ${dayLabel(day)}</h2>
    <div class="muted small">${esc(me.name)}, у тебя осталось: <b style="color:${left < 0 ? 'var(--bad)' : 'var(--ok)'}">${left} ккал</b>. Галка — блюдо влезает (твоя доля ${Math.round(share * 100)}%).</div>
    <input id="pq" placeholder="Поиск" style="margin:10px 0 4px">
    <div id="plist">${list()}</div>`, () => {
      bindList();
      $('#pq').oninput = e => { q = e.target.value.toLowerCase(); $('#plist').innerHTML = list(); bindList(); };
    });
}
function entrySheet(day, eid) {
  const e = (S.plan[day] || []).find(x => x.id === eid); if (!e) return;
  const r = getRecipe(e.rid);
  const ch = () => { mark('e:' + e.id); save(); draw(); };
  const draw = () => openSheet(`<h2>${esc(r.emoji)} ${esc(r.title)}</h2>
    ${hasVars(r) ? `<label class="f">${r.pick_one ? 'Вариант' : 'Добавки по желанию'}</label>${varChips(r, e.vars, 'data-v')}` : ''}
    <label class="f">Порций готовим</label>
    <div class="serv"><button id="pm">−</button><b>${e.portions}</b><button id="pp">＋</button></div>
    <label class="f">Кто сколько ест: ${S.profiles.map(p => esc(p.name) + ' ' + Math.round(entryKcal(e, r, p.id)) + ' ккал').join(', ')}</label>
    <div class="chips wrap">${SPLITS().map(([n, sp], i) => `<button class="chip ${JSON.stringify(e.split || null) === JSON.stringify(sp) ? 'on' : ''}" data-sp="${i}">${esc(n)}</button>`).join('')}</div>
    <label class="f">Перенести на</label><div class="chips">${week().map(d => `<button class="chip ${d === day ? 'on' : ''}" data-mv="${d}">${dayLabel(d)}</button>`).join('')}</div>
    <div class="row" style="margin-top:16px"><button class="btn danger grow" id="eDel">Убрать из плана</button><button class="btn pri grow" id="eOk">Готово</button></div>`, () => {
      document.querySelectorAll('#sheet [data-v]').forEach(b => b.onclick = () => { e.vars = toggleVar(r, e.vars, +b.dataset.v); ch(); });
      document.querySelectorAll('#sheet [data-sp]').forEach(b => b.onclick = () => { const sp = SPLITS()[+b.dataset.sp][1]; if (sp) e.split = sp; else delete e.split; ch(); });
      $('#pm').onclick = () => { e.portions = Math.max(1, e.portions - 1); ch(); };
      $('#pp').onclick = () => { e.portions++; ch(); };
      document.querySelectorAll('#sheet [data-mv]').forEach(b => b.onclick = () => {
        const to = b.dataset.mv; if (to === day) return;
        S.plan[day] = S.plan[day].filter(x => x.id !== eid); e.date = to; (S.plan[to] = S.plan[to] || []).push(e); day = to; ch();
      });
      $('#eDel').onclick = () => { S.plan[day] = S.plan[day].filter(x => x.id !== eid); mark('e:' + eid); save(); closeSheet(); render(); };
      $('#eOk').onclick = () => { closeSheet(); render(); };
    });
  draw();
}
function whoSheet(first) {
  openSheet(`<h2>${first ? 'Привет. Кто ты?' : 'Кто пользуется этим телефоном?'}</h2>
    <p class="muted small">Нужно, чтобы показывать твой остаток калорий. Поменять можно в настройках.</p>
    <div class="row">${S.profiles.map(p => `<button class="btn ${S.me === p.id ? 'pri' : ''} grow" data-me="${p.id}">${esc(p.name)}</button>`).join('')}</div>`,
    () => document.querySelectorAll('#sheet [data-me]').forEach(b => b.onclick = () => { S.me = b.dataset.me; save(true); closeSheet(); render(); }));
}
function settingsSheet() {
  const WDN = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'], order = [1, 2, 3, 4, 5, 6, 0];
  openSheet(`<h2>Настройки</h2>
    <h3>Это устройство</h3>
    <div class="row">${S.profiles.map(p => `<button class="btn ${S.me === p.id ? 'pri' : ''} grow" data-me="${p.id}">Я — ${esc(p.name)}</button>`).join('')}</div>
    <h3>Профили</h3>
    ${S.profiles.map((p, i) => `<div class="row" style="margin-top:6px"><input id="pn${i}" value="${esc(p.name)}" style="flex:2"><input id="pg${i}" type="number" inputmode="numeric" value="${p.goal}" title="ккал" style="flex:1.3"><input id="ps${i}" type="number" inputmode="numeric" value="${p.share}" title="доля %" style="flex:1"></div>`).join('')}
    <div class="muted small">Имя · цель, ккал в день · доля в общей порции, %</div>
    <label class="f">Порций по умолчанию при добавлении блюда</label><input id="sPpl" type="number" inputmode="numeric" value="${S.settings.people}">
    <h3>Кто готовит</h3>
    ${order.map(d => `<div class="row" style="justify-content:space-between;margin:4px 0"><span>${WDN[d]}</span><div class="row">${S.profiles.map(p => `<button class="chip ${S.cook[d] === p.id ? 'on' : ''}" data-ck="${d}:${p.id}">${esc(p.name)}</button>`).join('')}</div></div>`).join('')}
    <button class="btn pri full" id="sSave" style="margin-top:12px">Сохранить</button>
    <h3>Синхронизация</h3>
    <p class="muted small">Общий план, склад и покупки хранятся в приватном репозитории <b>${Sync.repo}</b>. Вставь токен GitHub с доступом только к нему (Contents: Read and write). Токен хранится только на этом устройстве.</p>
    <input id="sTok" type="password" placeholder="github_pat_…" value="${esc(Sync.token())}" autocomplete="off">
    <div class="row" style="margin-top:8px"><button class="btn grow" id="sTokSave">Сохранить токен</button><button class="btn grow" id="sNow">⟳ Синхронизировать</button></div>
    <div class="muted small" style="margin-top:6px" id="sStat">${esc(Sync.statusText())}</div>
    <h3>Резервная копия</h3>
    <div class="row"><button class="btn grow" id="sExp">📤 Скопировать всё</button><button class="btn grow" id="sExpR">📤 Только рецепты</button></div>
    <textarea id="sImp" placeholder="Вставь JSON сюда…" style="margin-top:8px;min-height:90px"></textarea>
    <button class="btn full" id="sImpB" style="margin-top:8px">📥 Импортировать</button>
    <h3>Сброс</h3>
    <button class="btn danger full" id="sReset">Вернуть встроенные рецепты</button>
    <h3>Приложение</h3>
    <p class="small">Сайт: <a href="${SITE}docs/" target="_blank" rel="noopener" style="color:var(--accent)">${SITE.replace('https://', '')}</a><br>Android: <a href="${SITE}docs/apk/Esurio.apk" target="_blank" rel="noopener" style="color:var(--accent)">скачать последнюю APK</a></p>
    <p class="muted small" style="text-align:center;margin-top:16px">Esurio v${APP_VERSION}</p>`, () => {
      document.querySelectorAll('#sheet [data-me]').forEach(b => b.onclick = () => { S.me = b.dataset.me; save(true); settingsSheet(); render(); });
      document.querySelectorAll('#sheet [data-ck]').forEach(b => b.onclick = () => { const [d, id] = b.dataset.ck.split(':'); S.cook[d] = id; mark('cfg:cook'); save(); settingsSheet(); render(); });
      $('#sSave').onclick = () => {
        S.profiles.forEach((p, i) => { p.name = $('#pn' + i).value.trim() || p.name; p.goal = Math.max(500, +$('#pg' + i).value || p.goal); p.share = Math.max(0, +$('#ps' + i).value || 0); });
        mark('cfg:profiles'); S.settings.people = Math.max(1, +$('#sPpl').value || 2); save(); closeSheet(); render(); toast('Сохранено');
      };
      $('#sTokSave').onclick = () => { Sync.setToken($('#sTok').value.trim()); toast('Токен сохранён'); Sync.run(); };
      $('#sNow').onclick = () => Sync.run(true);
      $('#sExp').onclick = () => copyText(JSON.stringify({ esurio: 1, ...S, timers: [], me: undefined }));
      $('#sExpR').onclick = () => copyText(JSON.stringify({ esurio: 1, recipes: Object.fromEntries(allRecipes().map(r => [r.id, r])) }));
      $('#sImpB').onclick = () => {
        try {
          let d = JSON.parse($('#sImp').value);
          if (Array.isArray(d)) d = { recipes: Object.fromEntries(d.map(r => [r.id || 'u-' + uid(), r])) };
          else if (d.title && d.ing) d = { recipes: { [d.id || 'u-' + uid()]: d } };
          let n = 0;
          for (const id in d.recipes || {}) { S.recipes[id] = Object.assign({}, d.recipes[id], { id, edited: true }); delete S.deleted[id]; mark('r:' + id, 'd:' + id); n++; }
          save(); closeSheet(); render(); toast(`Импортировано рецептов: ${n}`);
        } catch (e) { toast('Это не JSON. Или JSON, но кривой.'); }
      };
      $('#sReset').onclick = () => { closeSheet(); confirmSheet('Вернуть встроенные рецепты?', 'Ваши правки встроенных рецептов пропадут у обоих, свои рецепты останутся.', () => {
        for (const r of window.SEED_RECIPES) { if (S.recipes[r.id]) { delete S.recipes[r.id]; mark('r:' + r.id); } if (S.deleted[r.id]) { delete S.deleted[r.id]; mark('d:' + r.id); } } save(); render(); toast('Готово'); }); };
    });
}

/* ================= Синхронизация через приватный репозиторий GitHub =================
   Всё общее состояние раскладывается в плоскую карту «ключ -> {v, ts}».
   При слиянии по каждому ключу побеждает более свежая метка. Удаление = запись с v:null. */
const APP_VERSION = '1.9.3';
const SITE = 'https://metulaimmensa.github.io/esurio/';
// в APK раз в запуск проверяем, не вышла ли новая версия на сайте
async function checkUpdate() {
  if (!isNative) return;
  try {
    const v = await (await fetch(SITE + 'version.json?t=' + Date.now(), { cache: 'no-store' })).json();
    const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
    if (newer(v.version, APP_VERSION)) openSheet(`<h2>Вышла Esurio ${esc(v.version)}</h2><p class="muted">${esc(v.notes || '')}</p><a class="btn pri full" href="${SITE + v.apk}" target="_blank" rel="noopener">Скачать APK</a><button class="btn full" style="margin-top:8px" id="updLater">Потом</button>`, () => { $('#updLater').onclick = closeSheet; });
  } catch (e) { }
}
const Sync = (() => {
  const repo = 'metulaimmensa/esurio-data', path = 'state.json', TK = 'esurio.token';
  let busy = false, again = false, timer = null, last = null, err = '';
  const token = () => { try { return localStorage.getItem(TK) || ''; } catch (e) { return ''; } };
  const setToken = t => { try { localStorage.setItem(TK, t); } catch (e) { } };
  const b64e = s => btoa(unescape(encodeURIComponent(s)));
  const b64d = s => decodeURIComponent(escape(atob(s.replace(/\n/g, ''))));
  function toFlat() {
    const f = {}, put = (k, v) => { f[k] = { v, ts: S.ts[k] || 0 }; };
    for (const d in S.plan) for (const e of S.plan[d]) put('e:' + e.id, Object.assign({}, e, { date: d }));
    for (const n in S.pantry) put('p:' + n, typeof S.pantry[n] === 'number' ? S.pantry[n] : !!S.pantry[n]);
    for (const x of S.extras) put('x:' + x.id, x);
    for (const n of S.customProducts) put('cp:' + n, true);
    for (const id in S.recipes) put('r:' + id, S.recipes[id]);
    for (const id in S.deleted) if (S.deleted[id]) put('d:' + id, true);
    for (const d in S.cookOverride) put('co:' + d, S.cookOverride[d]);
    put('cfg:profiles', S.profiles); put('cfg:cook', S.cook);
    for (const k in S.ts) if (!(k in f)) f[k] = { v: null, ts: S.ts[k] }; // удалённое
    return f;
  }
  function fromFlat(f) {
    const plan = {}, pantry = {}, extras = [], cps = [], recipes = {}, deleted = {}, co = {}, ts = {};
    for (const k in f) {
      const { v, ts: t } = f[k]; if (t) ts[k] = t;
      if (v === null || v === undefined) continue;
      const i = k.indexOf(':'), type = k.slice(0, i), id = k.slice(i + 1);
      if (type === 'e') (plan[v.date] = plan[v.date] || []).push(v);
      else if (type === 'p') pantry[id] = v;
      else if (type === 'x') extras.push(v);
      else if (type === 'cp') cps.push(id);
      else if (type === 'r') recipes[id] = v;
      else if (type === 'd') deleted[id] = true;
      else if (type === 'co') co[id] = v;
      else if (k === 'cfg:profiles') S.profiles = v;
      else if (k === 'cfg:cook') S.cook = v;
    }
    Object.assign(S, { plan, pantry, extras, customProducts: cps, recipes, deleted, cookOverride: co, ts });
  }
  function merge(a, b) {
    const out = Object.assign({}, a);
    for (const k in b) if (!out[k] || (b[k].ts || 0) > (out[k].ts || 0)) out[k] = b[k];
    // чистим старые удаления (больше 60 дней)
    const old = now() - 60 * 864e5;
    for (const k in out) if (out[k].v === null && out[k].ts < old) delete out[k];
    return out;
  }
  const H = () => ({ Authorization: 'Bearer ' + token(), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  async function pull() {
    const r = await fetch(url + '?t=' + now(), { headers: H(), cache: 'no-store' });
    if (r.status === 404) return { flat: {}, sha: null };
    if (!r.ok) throw new Error(r.status === 401 ? 'токен не подходит' : r.status === 403 ? 'нет доступа к репозиторию' : 'GitHub ответил ' + r.status);
    const j = await r.json();
    return { flat: JSON.parse(b64d(j.content)).flat || {}, sha: j.sha };
  }
  async function push(flat, sha) {
    const body = { message: 'sync: ' + (S.me ? prof(S.me).name : 'устройство'), content: b64e(JSON.stringify({ v: 1, updated: new Date().toISOString(), flat }, null, 0)) };
    if (sha) body.sha = sha;
    const r = await fetch(url, { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, H()), body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) return false; // кто-то успел раньше — повторим
    if (!r.ok) throw new Error('не удалось записать: ' + r.status);
    return true;
  }
  function setStatus() { const el = $('#syncDot'); if (el) { el.textContent = !token() ? '' : busy ? '⟳' : err ? '⚠' : '☁'; el.title = statusText(); } const st = $('#sStat'); if (st) st.textContent = statusText(); }
  function statusText() {
    if (!token()) return 'Синхронизация выключена: нет токена.';
    if (busy) return 'Синхронизирую…';
    if (err) return 'Ошибка: ' + err;
    return last ? 'Синхронизировано в ' + new Date(last).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'Ещё не синхронизировалось.';
  }
  async function run(manual) {
    if (!token()) { if (manual) toast('Сначала вставь токен'); return; }
    if (busy) { again = true; return; }
    busy = true; err = ''; setStatus();
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const remote = await pull();
        const before = JSON.stringify(toFlat());
        const merged = merge(toFlat(), remote.flat);
        const changedLocal = JSON.stringify(merged) !== before;
        if (changedLocal) { const me = S.me; fromFlat(merged); S.me = me; save(true); }
        if (JSON.stringify(merged) === JSON.stringify(remote.flat)) { last = now(); if (changedLocal) softRender(); break; }
        if (await push(merged, remote.sha)) { last = now(); if (changedLocal) softRender(); break; }
      }
      if (manual) toast('Синхронизировано');
    } catch (e) { err = e.message || String(e); if (manual) toast('Синхронизация: ' + err); }
    busy = false; setStatus();
    if (again) { again = false; later(); }
  }
  function later() { clearTimeout(timer); timer = setTimeout(run, 2500); }
  return { run, later, token, setToken, statusText, setStatus, repo };
})();
// перерисовать, не мешая человеку: если открыта шторка или он печатает — подождём
function softRender() {
  const typing = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
  if ($('#sheet').classList.contains('hidden') && !typing) render(); else setTimeout(softRender, 3000);
}

/* ================= Таймеры ================= */
const Cap = window.capacitorExports && window.capacitorExports.Capacitor;
const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
const LN = isNative && window.capacitorLocalNotifications ? window.capacitorLocalNotifications.LocalNotifications : null;
const HP = isNative && window.capacitorHaptics ? window.capacitorHaptics.Haptics : null;
let audioCtx;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    for (let n = 0; n < 3; n++) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.0001, t0 + n * 0.35); g.gain.exponentialRampToValueAtTime(0.4, t0 + n * 0.35 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + n * 0.35 + 0.25);
      o.start(t0 + n * 0.35); o.stop(t0 + n * 0.35 + 0.3);
    }
  } catch (e) { }
}
function buzz() { try { if (HP) HP.vibrate({ duration: 800 }); else navigator.vibrate && navigator.vibrate([400, 150, 400]); } catch (e) { } }
let notifAsked = false;
async function startTimer(label, sec) {
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (e) { }
  const t = { id: uid(), nid: Math.floor(Math.random() * 1e9), label, dur: sec, end: Date.now() + sec * 1000, fired: false, paused: null };
  S.timers.push(t); save(); renderTimers(); toast(`Таймер ${fmtTime(sec)} пошёл`);
  if (LN) {
    try {
      if (!notifAsked) { notifAsked = true; const p = await LN.checkPermissions(); if (p.display !== 'granted') await LN.requestPermissions(); }
      await scheduleNotif(t);
    } catch (e) { console.warn(e); }
  }
}
async function scheduleNotif(t) {
  if (!LN) return;
  try { await LN.schedule({ notifications: [{ id: t.nid, title: '⏱ Таймер готов', body: t.label, schedule: { at: new Date(t.end), allowWhileIdle: true }, channelId: 'timers' }] }); } catch (e) { console.warn(e); }
}
async function cancelNotif(t) { if (LN) try { await LN.cancel({ notifications: [{ id: t.nid }] }); } catch (e) { } }
function removeTimer(id) { const t = S.timers.find(x => x.id === id); if (t) cancelNotif(t); S.timers = S.timers.filter(x => x.id !== id); save(); renderTimers(); }
function togglePause(id) {
  const t = S.timers.find(x => x.id === id); if (!t || t.fired) return;
  if (t.paused == null) { t.paused = t.end - Date.now(); cancelNotif(t); }
  else { t.end = Date.now() + t.paused; t.paused = null; scheduleNotif(t); }
  save(); renderTimers();
}
function addMinute(id) { const t = S.timers.find(x => x.id === id); if (!t) return; if (t.paused != null) t.paused += 60000; else { if (t.fired) { t.end = Date.now(); t.fired = false; } t.end += 60000; cancelNotif(t).then(() => scheduleNotif(t)); } save(); renderTimers(); }
let timerKey = '';
const timerLeft = t => t.paused != null ? t.paused / 1000 : (t.end - Date.now()) / 1000;
function renderTimers() {
  const bar = $('#timerBar');
  const key = S.timers.map(t => `${t.id}:${t.fired}:${t.paused != null}`).join(',');
  if (key === timerKey) { // структура не поменялась — обновляем только цифры, кнопки не трогаем
    S.timers.forEach(t => { const c = bar.querySelector(`[data-tid="${t.id}"] .clk`); if (c) c.textContent = t.fired ? '0:00' : fmtTime(timerLeft(t)); });
    return;
  }
  timerKey = key;
  bar.innerHTML = S.timers.map(t => {
    return `<div class="tm ${t.fired ? 'ring' : ''}" data-tid="${t.id}">
      <div class="clk">${t.fired ? '0:00' : fmtTime(timerLeft(t))}</div><div class="lbl">${esc(t.label)}</div>
      ${t.fired ? '' : `<button data-tp="${t.id}">${t.paused != null ? '▶' : '❚❚'}</button>`}
      <button data-tm="${t.id}">+1</button><button data-tx="${t.id}">${t.fired ? 'OK' : '✕'}</button></div>`;
  }).join('');
  bar.querySelectorAll('[data-tp]').forEach(b => b.onclick = () => togglePause(b.dataset.tp));
  bar.querySelectorAll('[data-tm]').forEach(b => b.onclick = () => addMinute(b.dataset.tm));
  bar.querySelectorAll('[data-tx]').forEach(b => b.onclick = () => removeTimer(b.dataset.tx));
  document.body.style.paddingBottom = `calc(${72 + S.timers.length * 58}px + var(--safe-b))`;
}
setInterval(() => {
  if (!S.timers.length) return;
  let changed = false;
  for (const t of S.timers) {
    if (!t.fired && t.paused == null && Date.now() >= t.end) { t.fired = true; changed = true; beep(); buzz(); toast(`⏱ ${t.label}`); }
  }
  if (changed) save();
  // звеним повторно, пока не нажали OK
  if (S.timers.some(t => t.fired) && Math.floor(Date.now() / 1000) % 4 === 0) { beep(); buzz(); }
  renderTimers();
}, 1000);

/* ================= Старт ================= */
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
$('#backBtn').onclick = back;
$('#settingsBtn').onclick = settingsSheet;
if (LN) { try { LN.createChannel({ id: 'timers', name: 'Таймеры', importance: 5, vibration: true, visibility: 1 }); } catch (e) { } }
if (Cap && isNative) {
  // аппаратная кнопка «назад»
  document.addEventListener('backbutton', e => e.preventDefault());
  try { const App = Cap.registerPlugin('App'); App.addListener('backButton', () => { if (!$('#sheet').classList.contains('hidden')) closeSheet(); else if (stack.length > 1) back(); else if (tab !== 'recipes') setTab('recipes'); else App.exitApp(); }); } catch (e) { }
}
setTab('recipes');
renderTimers();
Sync.setStatus();
if (!S.me) whoSheet(true); else setTimeout(checkUpdate, 3000);
Sync.run();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Sync.run(); });
setInterval(() => { if (document.visibilityState === 'visible') Sync.run(); }, 45000);
