/*
 * Netlabor docs search. Deliberately plain JS, loaded on first use so content
 * pages ship no framework runtime. Styling lives in docs.css and comes from the
 * app's tokens.
 */
(() => {
  const INDEX_URL = '/search-index.json';
  let pages = null;
  let root = null;
  let input = null;
  let list = null;
  let results = [];
  let active = 0;
  let previousFocus = null;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function subsequence(haystack, needle) {
    let cursor = 0;
    for (const char of needle) {
      const next = haystack.indexOf(char, cursor);
      if (next === -1) return false;
      cursor = next + 1;
    }
    return true;
  }

  function excerpt(body, query) {
    const at = query ? body.toLowerCase().indexOf(query) : -1;
    if (at === -1) return body.slice(0, 110);
    const start = Math.max(0, at - 40);
    return `${start > 0 ? '…' : ''}${body.slice(start, start + 130).trim()}…`;
  }

  function rank(page, query) {
    const title = page.title.toLowerCase();
    const headings = page.headings.join(' ').toLowerCase();
    const body = page.body.toLowerCase();
    let score = 0;
    for (const token of query.split(/\s+/).filter(Boolean)) {
      if (title.includes(token)) score += 10;
      else if (headings.includes(token)) score += 6;
      else if (body.includes(token)) score += 2;
      else if (token.length > 2 && subsequence(title, token)) score += 3;
      else return 0;
    }
    if (title.includes(query)) score += 12;
    if (subsequence(title, query)) score += 6;
    return score;
  }

  function search(query) {
    const needle = query.trim().toLowerCase();
    if (!needle) return pages.slice(0, 9);
    return pages
      .map((page) => ({ page, score: rank(page, needle) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 12)
      .map((entry) => entry.page);
  }

  function paint() {
    list.textContent = '';
    if (results.length === 0) {
      const empty = element('li', 'nb-search__empty', 'No page matches that.');
      list.append(empty);
      return;
    }
    results.forEach((page, index) => {
      const row = element('li', 'nb-search__row');
      const link = element('a', 'nb-search__link');
      link.href = page.href;
      link.setAttribute('role', 'option');
      link.setAttribute('aria-selected', String(index === active));
      if (index === active) row.dataset.active = 'true';
      link.append(element('span', 'nb-search__title', page.title));
      link.append(element('span', 'nb-search__path', page.href));
      link.append(
        element('span', 'nb-search__excerpt', excerpt(page.body, input.value.trim().toLowerCase())),
      );
      link.addEventListener('mousemove', () => {
        if (active === index) return;
        active = index;
        paint();
      });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        close();
        window.location.href = page.href;
      });
      row.append(link);
      list.append(row);
    });
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  function refresh() {
    results = search(input.value);
    active = 0;
    paint();
  }

  function onKeydown(event) {
    if (!root || root.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length === 0) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      active = (active + delta + results.length) % results.length;
      paint();
      return;
    }
    if (event.key === 'Enter') {
      const page = results[active];
      if (!page) return;
      event.preventDefault();
      close();
      window.location.href = page.href;
    }
  }

  function close() {
    if (!root || root.hidden) return;
    root.hidden = true;
    document.documentElement.classList.remove('nb-search-open');
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  }

  function build() {
    root = element('div', 'nb-search');
    root.hidden = true;
    root.setAttribute('role', 'presentation');

    const backdrop = element('div', 'nb-search__backdrop');
    backdrop.addEventListener('click', close);

    const panel = element('div', 'nb-search__panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Search the documentation');

    const field = element('div', 'nb-search__field');
    const glyph = element('span', 'nb-search__glyph', '/');
    glyph.setAttribute('aria-hidden', 'true');
    input = element('input', 'nb-search__input');
    input.type = 'search';
    input.placeholder = 'Search docs…';
    input.setAttribute('aria-label', 'Search the documentation');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    input.addEventListener('input', refresh);
    const hint = element('span', 'nb-search__hint', 'esc');
    hint.setAttribute('aria-hidden', 'true');
    field.append(glyph, input, hint);

    list = element('ul', 'nb-search__list');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Results');

    panel.append(field, list);
    root.append(backdrop, panel);
    root.addEventListener('keydown', onKeydown);
    document.body.append(root);
  }

  async function open() {
    if (!pages) {
      const response = await fetch(INDEX_URL);
      if (!response.ok) return;
      pages = (await response.json()).pages;
    }
    if (!root) build();
    previousFocus = document.activeElement;
    root.hidden = false;
    document.documentElement.classList.add('nb-search-open');
    input.value = '';
    refresh();
    input.focus();
  }

  // Loaded lazily by the inline hotkey handler; also usable after a direct load.
  window.nbDocsSearch = open;
  window.addEventListener('keydown', (event) => {
    if (!root || root.hidden) return;
    if (event.key === 'Escape') close();
  });
})();
