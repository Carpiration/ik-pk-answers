(() => {
  'use strict';

  const FILES = window.DATA || [];
  const byId = Object.fromEntries(FILES.map((f) => [f.id, f]));
  const ALL = [];
  const BASE_TITLE = document.title;

  const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  FILES.forEach((f, fi) => {
    f.items.forEach((it, i) => {
      it.file = f.id;
      it.fi = fi;
      it.i = i;
      it.key = f.tickets ? `${it.t}-${it.n}` : String(it.n);
      it.domId = `${f.id}-${it.key}`;
      it.where = f.tickets ? `Билет ${it.t}, вопрос ${it.n}` : `Вопрос ${it.n}`;
      it.short = f.tickets ? `билет ${it.t}, в. ${it.n}` : `№${it.n}`;
      it.text = it.a.join(' ');
      it.nq = ' ' + norm(it.q);
      it.na = ' ' + norm(it.text);
      ALL.push(it);
    });
    if (f.tickets) f.ticketCount = Math.max(...f.items.map((it) => it.t));
    // одинаковые вопросы внутри файла (в исходниках они повторяются с теми же ответами)
    const same = new Map();
    for (const it of f.items) {
      const k = it.nq;
      if (!same.has(k)) same.set(k, []);
      same.get(k).push(it);
    }
    for (const it of f.items) {
      it.dups = same.get(it.nq).filter((x) => x !== it);
      it.primary = same.get(it.nq)[0] === it;
    }
  });

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const input = $('q');
  const clearBtn = $('clear');
  const panel = $('results-panel');
  const list = $('results');
  const summary = $('summary');
  const scrim = $('scrim');
  const main = $('main');
  const header = document.querySelector('.top');
  const toTop = $('toTop');

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
  };

  /* ---------- Подсветка совпадений ---------- */
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Упрощенная основа слова, чтобы находить разные падежи:
  // «внимание» → «вниман» найдет «внимания», «о внимании».
  const stem = (t) => (/^\d+$/.test(t) || t.length <= 3 ? t : t.length === 4 ? t.slice(0, 3) : t.slice(0, Math.max(4, t.length - 2)));

  function makeRe(tokens) {
    if (!tokens || !tokens.length) return null;
    const ye = (x) => escapeRe(x).replace(/е/g, '[её]');
    const exact = [...tokens].sort((a, b) => b.length - a.length).map(ye);
    const stems = tokens.map((t) => `${ye(stem(t))}[\\p{L}\\p{N}]*`);
    try {
      return new RegExp(`((?<![\\p{L}\\p{N}])(?:${stems.join('|')})|${exact.join('|')})`, 'giu');
    } catch {
      return new RegExp(`(${exact.join('|')})`, 'giu'); // браузер без lookbehind
    }
  }

  function marked(text, re) {
    if (!re) return [text];
    return text.split(re).map((part, i) => (i % 2 ? h('mark', null, part) : part)).filter((p) => p !== '');
  }

  function snippet(text, re) {
    re.lastIndex = 0;
    const m = re.exec(text);
    re.lastIndex = 0;
    if (!m) return text.slice(0, 120) + '…';
    const start = Math.max(0, m.index - 50);
    const end = Math.min(text.length, m.index + m[0].length + 80);
    return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
  }

  /* ---------- Поиск ---------- */
  function parseQuery(raw) {
    const t = raw.trim().toLowerCase().replace(/ё/g, 'е');
    if (!t) return null;
    let m;
    if ((m = t.match(/^№?\s*(\d{1,3})$/))) return { type: 'num', n: +m[1] };
    if ((m = t.match(/^(?:билет\s*)?(\d{1,3})\s*[.\-/,:\s]\s*(\d{1,2})$/))) return { type: 'ticket', t: +m[1], n: +m[2] };
    if ((m = t.match(/^билет\s*№?\s*(\d{1,3})$/))) return { type: 'ticket', t: +m[1] };
    if ((m = t.match(/^(ик|пк|пси[а-я]*)\s*№?\s*(\d{1,3})(?:\s*[.\-/,:\s]\s*(\d{1,2}))?$/))) {
      const file = m[1] === 'ик' ? 'ik' : m[1] === 'пк' ? 'pk' : 'psy';
      if (file === 'psy') return { type: 'ticket', t: +m[2], n: m[3] ? +m[3] : undefined };
      return { type: 'num', n: +m[2], file };
    }
    const tokens = norm(t).split(' ').filter(Boolean);
    return tokens.length ? { type: 'text', tokens, phrase: tokens.join(' ') } : null;
  }

  function searchNumber(q) {
    const groups = [];
    for (const f of FILES) {
      if (q.file && q.file !== f.id) continue;
      if (q.type === 'ticket' && !f.tickets) continue;
      let items;
      let title;
      if (f.tickets) {
        const t = q.type === 'ticket' ? q.t : q.n;
        items = f.items.filter((it) => it.t === t && (q.type !== 'ticket' || q.n == null || it.n === q.n));
        title = `${f.name} · билет ${t}`;
      } else {
        items = f.items.filter((it) => it.n === q.n);
        title = `${f.name} · №${q.n}`;
      }
      if (items.length) groups.push({ title, file: f.id, items });
    }
    return groups;
  }

  // -1 — не подходит; иначе чем больше, тем выше в списке
  function score(text, q) {
    let sc = 0;
    for (let k = 0; k < q.tokens.length; k++) {
      const tok = q.tokens[k];
      if (text.includes(' ' + tok)) sc += 10; // точное слово или его начало
      else if (text.includes(' ' + q.stems[k])) sc += 6; // другая форма слова
      else if (tok.length >= 3 && text.includes(tok)) sc += 3; // внутри слова
      else return -1;
    }
    if (q.tokens.length > 1 && text.includes(' ' + q.phrase)) sc += 40;
    if (text.startsWith(' ' + q.phrase)) sc += 20;
    return sc;
  }

  function searchText(q) {
    const tq = { tokens: q.tokens, stems: q.tokens.map(stem), phrase: q.phrase };
    const inQ = [];
    const inA = [];
    for (const it of ALL) {
      if (!it.primary) continue; // повтор показываем один раз, номера — в подписи
      const s = score(it.nq, tq);
      if (s >= 0) inQ.push({ it, s: s - it.nq.length / 400 });
      else if (tq.phrase.length >= 3) {
        const sa = score(it.na, tq);
        if (sa >= 0) inA.push({ it, s: sa });
      }
    }
    const order = (a, b) => b.s - a.s || a.it.fi - b.it.fi || a.it.i - b.it.i;
    inQ.sort(order);
    inA.sort(order);
    return { inQ: inQ.map((x) => x.it), inA: inA.map((x) => x.it) };
  }

  let options = [];
  let active = -1;
  let lastTokens = null;

  function option(it, re, withSnippet) {
    const idx = options.length;
    options.push(it);
    return h('div', {
      class: 'opt', role: 'option', id: `opt-${idx}`, 'data-file': it.file, 'aria-selected': 'false',
      onclick: () => choose(idx),
    },
    h('span', { class: 'badge', text: byId[it.file].short }),
    h('span', { class: 'opt__q' }, marked(it.q, withSnippet ? null : re)),
    h('span', { class: 'opt__meta', text: it.where + (it.dups.length ? ` · также ${it.dups.map((d) => d.short).join('; ')}` : '') }),
    withSnippet ? h('span', { class: 'opt__snip' }, marked(snippet(it.text, re), re)) : null);
  }

  function group(title, children) {
    const gid = `g-${list.childElementCount}`;
    return h('div', { role: 'group', 'aria-labelledby': gid },
      h('p', { class: 'results__group-title', id: gid, text: title }), children);
  }

  const plural = (n, one, few, many) => {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };
  const countQ = (n) => `${n} ${plural(n, 'вопрос', 'вопроса', 'вопросов')}`;

  function renderResults() {
    const raw = input.value;
    clearBtn.hidden = !raw;
    const q = parseQuery(raw);
    options = [];
    active = -1;
    list.replaceChildren();
    input.removeAttribute('aria-activedescendant');
    if (!q) { closeResults(); lastTokens = null; return; }

    if (q.type === 'text') {
      lastTokens = q.tokens;
      const { inQ, inA } = searchText(q);
      const re = makeRe(lastTokens);
      if (inQ.length) list.append(group('В вопросах', inQ.slice(0, 80).map((it) => option(it, re, false))));
      if (inA.length) list.append(group('Только в тексте ответа', inA.slice(0, 40).map((it) => option(it, re, true))));
      if (!inQ.length && !inA.length) {
        summary.textContent = '';
        list.append(h('div', { class: 'results__empty' },
          h('p', null, `Ничего не найдено по запросу «${raw.trim()}».`),
          h('p', null, 'Попробуйте одно ключевое слово или номер вопроса.')));
      } else {
        summary.textContent = inQ.length
          ? `Найдено в вопросах: ${inQ.length}${inA.length ? `, только в ответах: ${inA.length}` : ''}`
          : `В вопросах не найдено, в ответах: ${inA.length}`;
      }
    } else {
      lastTokens = null;
      const groups = searchNumber(q);
      for (const g of groups) list.append(group(g.title, g.items.map((it) => option(it, null, false))));
      if (groups.length) {
        summary.textContent = `Найдено: ${countQ(options.length)}`;
      } else {
        summary.textContent = '';
        const limits = FILES.map((f) => (f.tickets ? `${f.name}: ${f.ticketCount} билета по 3 вопроса` : `${f.name}: ${countQ(f.items.length)}`));
        list.append(h('div', { class: 'results__empty' },
          h('p', null, 'Такого номера нет.'),
          h('p', null, limits.join('; ') + '.')));
      }
    }
    openResults();
  }

  function openResults() {
    panel.hidden = false;
    scrim.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function closeResults() {
    panel.hidden = true;
    scrim.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function setActive(i) {
    const els = list.querySelectorAll('.opt');
    if (!els.length) return;
    if (active >= 0 && els[active]) { els[active].classList.remove('is-active'); els[active].setAttribute('aria-selected', 'false'); }
    active = (i + els.length) % els.length;
    const el = els[active];
    el.classList.add('is-active');
    el.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', el.id);
    el.scrollIntoView({ block: 'nearest' });
  }

  let pendingTokens = null;
  function choose(idx) {
    const it = options[idx];
    if (!it) return;
    pendingTokens = lastTokens;
    closeResults();
    if (matchMedia('(pointer: coarse)').matches) input.blur(); // убрать клавиатуру на телефоне
    const hash = `#/${it.file}/${it.key}`;
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  input.addEventListener('input', renderResults);
  input.addEventListener('focus', () => { if (input.value.trim()) renderResults(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (panel.hidden) renderResults(); else setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (!panel.hidden && options.length) choose(active >= 0 ? active : 0); }
    else if (e.key === 'Escape') {
      if (!panel.hidden) closeResults();
      else if (input.value) { input.value = ''; renderResults(); }
    }
  });
  clearBtn.addEventListener('click', () => { input.value = ''; renderResults(); input.focus(); });
  scrim.addEventListener('click', closeResults);
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); input.focus(); input.select(); }
  });

  /* ---------- Размер текста ---------- */
  const SIZES = [15, 16, 17, 18, 20, 22, 24];
  let sizeIdx = SIZES.indexOf(+storage.get('fs'));
  if (sizeIdx < 0) sizeIdx = 2;
  const applySize = () => document.documentElement.style.setProperty('--fs', SIZES[sizeIdx] + 'px');
  applySize();

  /* ---------- Страницы ---------- */
  let currentFile = null;
  let currentTarget = null;

  function renderHome() {
    currentFile = null;
    currentTarget = null;
    document.title = BASE_TITLE;
    main.removeAttribute('data-file');
    main.replaceChildren(
      h('section', { class: 'intro' },
        h('h1', null, 'Вопросы и ответы'),
        h('p', null, 'Три файла. Ищите по словам из вопроса или по номеру — сразу во всех.')),
      h('nav', { class: 'cards', 'aria-label': 'Файлы' }, FILES.map((f) => h('a', { class: 'card', href: `#/${f.id}`, 'data-file': f.id },
        h('span', { class: 'card__name' }, h('strong', null, f.name), h('span', { class: 'badge', text: f.short })),
        h('span', { class: 'card__title', text: f.title }),
        h('span', { class: 'card__count', text: f.tickets ? `${f.ticketCount} билета · ${countQ(f.items.length)}` : countQ(f.items.length) })))),
      h('section', { class: 'tips' },
        h('h2', null, 'Как искать'),
        h('ul', null,
          h('li', null, h('code', null, 'синапс'), ' — по словам из вопроса во всех трех файлах'),
          h('li', null, h('code', null, '14'), ' — 14-й вопрос в ИК и ПК и билет 14 по психологии'),
          h('li', null, h('code', null, '14.2'), ' — билет 14, вопрос 2 по психологии'),
          h('li', null, h('code', null, 'ик 14'), ', ', h('code', null, 'пк 14'), ' — номер только в одном файле')))
    );
    window.scrollTo(0, 0);
  }

  function qaBlock(it) {
    return h('article', { class: 'qa', id: it.domId, 'data-file': it.file },
      h('h3', { class: 'qa__q' },
        h('span', { class: 'qa__n', 'aria-label': it.where, text: `${it.n}.` }),
        h('a', { href: `#/${it.file}/${it.key}` }, it.q)),
      it.dups.length ? h('p', { class: 'qa__dup' }, 'Этот же вопрос: ',
        it.dups.map((d, i) => [i ? ', ' : '', h('a', { href: `#/${d.file}/${d.key}` }, d.short)])) : null,
      it.a.map((p) => h('p', { class: 'qa__a' }, p)));
  }

  function fillQa(el, it, re) {
    el.querySelector('.qa__q a').replaceChildren(...marked(it.q, re));
    el.querySelectorAll('.qa__a').forEach((p, i) => p.replaceChildren(...marked(it.a[i], re)));
  }

  function renderFile(f) {
    currentFile = f.id;
    currentTarget = null;
    document.title = `${f.name} — ${BASE_TITLE}`;
    main.setAttribute('data-file', f.id);

    const tabs = h('nav', { class: 'tabs', 'aria-label': 'Файлы' }, FILES.map((x) =>
      h('a', { class: 'tab', href: `#/${x.id}`, 'data-file': x.id, 'aria-current': x.id === f.id ? 'page' : null, text: x.short })));

    const minus = h('button', { type: 'button', 'aria-label': 'Уменьшить текст', text: 'A−' });
    const plus = h('button', { type: 'button', 'aria-label': 'Увеличить текст', text: 'A+' });
    const syncSize = () => { minus.disabled = sizeIdx === 0; plus.disabled = sizeIdx === SIZES.length - 1; };
    const step = (d) => { sizeIdx = Math.min(SIZES.length - 1, Math.max(0, sizeIdx + d)); applySize(); syncSize(); storage.set('fs', SIZES[sizeIdx]); };
    minus.addEventListener('click', () => step(-1));
    plus.addEventListener('click', () => step(1));
    syncSize();

    const tocLinks = f.tickets
      ? Array.from({ length: f.ticketCount }, (_, i) => h('a', { href: `#/${f.id}/${i + 1}`, 'aria-label': `Билет ${i + 1}`, text: i + 1 }))
      : f.items.map((it) => h('a', { href: `#/${f.id}/${it.key}`, 'aria-label': `Вопрос ${it.n}`, text: it.n }));

    const body = [];
    let lastTicket = null;
    for (const it of f.items) {
      if (f.tickets && it.t !== lastTicket) {
        lastTicket = it.t;
        body.push(h('h2', { class: 'ticket-h', id: `${f.id}-${it.t}` }, `Билет ${it.t}`));
      }
      body.push(qaBlock(it));
    }

    main.replaceChildren(
      tabs,
      h('div', { class: 'file-head' }, h('h1', null, f.title), h('p', null, f.subtitle)),
      h('div', { class: 'toolbar' },
        h('details', { class: 'toc' },
          h('summary', null, f.tickets ? 'Перейти к билету' : 'Перейти к номеру'),
          h('div', { class: 'toc__grid' }, tocLinks)),
        h('div', { class: 'size', role: 'group', 'aria-label': 'Размер текста' }, minus, plus)),
      h('div', { class: 'qa-list' }, body),
      f.sources.length ? h('section', { class: 'sources' },
        h('h2', null, 'Источники для проверки и повторения'),
        h('ul', null, f.sources.map((s) => h('li', null, s)))) : null
    );
  }

  function clearTarget() {
    if (!currentTarget) return;
    const { el, it } = currentTarget;
    el.classList.remove('is-target', 'is-flash');
    if (it) fillQa(el, it, null);
    currentTarget = null;
  }

  function focusTarget(f, key) {
    clearTarget();
    const el = document.getElementById(`${f.id}-${key}`);
    if (!el) { window.scrollTo(0, 0); return; }
    const it = f.items.find((x) => x.key === key);
    if (it) {
      el.classList.add('is-target');
      if (pendingTokens) fillQa(el, it, makeRe(pendingTokens));
      // перезапуск короткой вспышки, чтобы глаз нашел блок
      el.classList.remove('is-flash');
      void el.offsetWidth;
      el.classList.add('is-flash');
    }
    currentTarget = { el, it };
    el.scrollIntoView({ block: 'start' });
    const details = main.querySelector('.toc');
    if (details) details.open = false;
  }

  function route() {
    const path = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    const [fid, key] = path.split('/');
    const f = byId[fid];
    closeResults();
    if (!f) { renderHome(); pendingTokens = null; return; }
    const changed = currentFile !== f.id;
    if (changed) renderFile(f);
    if (key) focusTarget(f, key);
    else { clearTarget(); window.scrollTo(0, 0); }
    pendingTokens = null;
    updateToTop();
  }

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('hashchange', route);

  /* ---------- Высота шапки и кнопка «Наверх» ---------- */
  const setTopH = () => document.documentElement.style.setProperty('--top-h', header.querySelector('.top__row').offsetHeight + 'px');
  setTopH();
  if ('ResizeObserver' in window) new ResizeObserver(setTopH).observe(header.querySelector('.top__row'));

  let ticking = false;
  function updateToTop() { toTop.hidden = !(currentFile && window.scrollY > 900); }
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { updateToTop(); ticking = false; });
  }, { passive: true });
  toTop.addEventListener('click', () => {
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
  });

  route();

  /* ---------- Работа без сети ---------- */
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
