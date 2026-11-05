// A little formatting for text people type on their profiles. Stored as plain
// text with a few Markdown-ish marks:
//   **bold**   *italic*   [label](https://…)   bare https://… links
// and, in multi-line fields (block mode), lines starting "- " for bullets or
// "1. " for a numbered list. Everything is built with createElement and
// textContent, never innerHTML, so nothing typed can become real markup, and
// links only go to http(s) or mailto addresses.
//   RichText.render(text, { block })   -> DocumentFragment
//   RichText.toolbar(input, { block }) -> a row of B / I / link (/ list) buttons
window.RichText = (function () {
  // One of: [label](url) | ***both*** | **bold** | *italic* | a bare link.
  const INLINE = /\[([^\]\n]+)\]\(([^()\s]+)\)|\*\*\*(?=[^\s*])([^\n]*?[^\s*])\*\*\*|\*\*(?=\S)([^\n]*?\S)\*\*|\*(?=[^\s*])([^*\n]*?[^\s*])\*|((?:https?:\/\/|www\.)[^\s<>"]+)/g;
  const BULLET = /^\s*[-*•]\s+(.*)$/;
  const NUMBER = /^\s*(\d{1,3})[.)]\s+(.*)$/;
  // Left off the end of a bare link: "see https://x.com." means x.com.
  const TRAILING = /[.,!?;:'"]+$/;

  // The address to link to, or null if it isn't a web or mail link.
  function safeHref(raw) {
    const s = /^www\./i.test(raw) ? 'https://' + raw : raw;
    try {
      const url = new URL(s);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
      if (url.protocol === 'mailto:' && /^mailto:/i.test(s)) return url.href;
    } catch {}
    return null;
  }

  // A link inside a link's label just shows its label.
  function link(href, label, noLinks) {
    if (noLinks) return inline(label, true);
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer nofollow ugc';
    a.appendChild(inline(label, true));
    return a;
  }

  // Inline marks in one run of text. noLinks: inside a link label already.
  function inline(text, noLinks) {
    const frag = document.createDocumentFragment();
    const re = new RegExp(INLINE.source, 'g');
    let at = 0, m;
    while ((m = re.exec(text))) {
      let whole = m[0];
      let node = null;
      if (m[1] != null) {
        const href = safeHref(m[2]);
        node = href ? link(href, m[1], noLinks) : null;
      } else if (m[3] != null) {
        node = document.createElement('strong');
        const em = document.createElement('em');
        em.appendChild(inline(m[3], noLinks));
        node.appendChild(em);
      } else if (m[4] != null) {
        node = document.createElement('strong');
        node.appendChild(inline(m[4], noLinks));
      } else if (m[5] != null) {
        node = document.createElement('em');
        node.appendChild(inline(m[5], noLinks));
      } else if (m[6] != null && !noLinks) {
        whole = m[6].replace(TRAILING, '');
        // An unmatched ")" at the end belongs to the sentence, not the link.
        while (whole.endsWith(')') && (whole.match(/\(/g) || []).length < (whole.match(/\)/g) || []).length) {
          whole = whole.slice(0, -1);
        }
        const href = safeHref(whole);
        if (href) node = link(href, whole, false);
        re.lastIndex = m.index + whole.length;
      }
      if (!node) {
        // Not something we format: keep the first character and look again
        // just past it, so marks inside it still get a chance.
        re.lastIndex = m.index + 1;
        continue;
      }
      if (m.index > at) frag.appendChild(document.createTextNode(text.slice(at, m.index)));
      frag.appendChild(node);
      at = m.index + whole.length;
    }
    if (at < text.length) frag.appendChild(document.createTextNode(text.slice(at)));
    return frag;
  }

  // Paragraphs, line breaks and lists, then inline marks within each.
  function block(text) {
    const frag = document.createDocumentFragment();
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    let para = null, list = null, listType = null;
    const endPara = () => { para = null; };
    const endList = () => { list = null; listType = null; };
    for (const line of lines) {
      const bullet = line.match(BULLET);
      const number = !bullet && line.match(NUMBER);
      if (bullet || number) {
        endPara();
        const type = bullet ? 'ul' : 'ol';
        if (listType !== type) {
          list = document.createElement(type);
          if (number && number[1] !== '1') list.start = Number(number[1]);
          listType = type;
          frag.appendChild(list);
        }
        const li = document.createElement('li');
        li.appendChild(inline(bullet ? bullet[1] : number[2]));
        list.appendChild(li);
        continue;
      }
      endList();
      if (!line.trim()) { endPara(); continue; }
      if (para) para.appendChild(document.createElement('br'));
      else { para = document.createElement('p'); frag.appendChild(para); }
      para.appendChild(inline(line));
    }
    return frag;
  }

  function render(text, opts) {
    if (text == null || text === '') return document.createDocumentFragment();
    return opts && opts.block ? block(text) : inline(String(text));
  }

  // ── Editing ─────────────────────────────────────────────────────────────

  // Put the new value in (unless it'd go over the field's limit), select
  // [selStart, selEnd), and let the counters know.
  function apply(input, value, selStart, selEnd) {
    if (input.maxLength > 0 && value.length > input.maxLength) return false;
    input.value = value;
    input.focus();
    input.setSelectionRange(selStart, selEnd);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  // Wrap the selection in a mark, or unwrap it if it's already wrapped.
  function wrap(input, mark, placeholder) {
    const v = input.value, s = input.selectionStart, e = input.selectionEnd;
    const n = mark.length;
    const before = v.slice(s - n, s), after = v.slice(e, e + n);
    // For italics, "**" around the selection is bold, not italic.
    const wrapped = before === mark && after === mark &&
      !(mark === '*' && v.charAt(s - 2) === '*' && v.charAt(e + 1) === '*');
    if (wrapped && s !== e) {
      return apply(input, v.slice(0, s - n) + v.slice(s, e) + v.slice(e + n), s - n, e - n);
    }
    const sel = v.slice(s, e) || placeholder;
    return apply(input, v.slice(0, s) + mark + sel + mark + v.slice(e), s + n, s + n + sel.length);
  }

  function addLink(input) {
    const v = input.value, s = input.selectionStart, e = input.selectionEnd;
    const sel = v.slice(s, e);
    if (/^(https?:\/\/|www\.)\S+$/i.test(sel)) {
      // They selected an address: make it the link, with the label to type.
      const text = '[link text](' + sel + ')';
      return apply(input, v.slice(0, s) + text + v.slice(e), s + 1, s + 10);
    }
    const label = sel || 'link text';
    const text = '[' + label + '](https://)';
    const urlStart = s + label.length + 3;
    return apply(input, v.slice(0, s) + text + v.slice(e), urlStart, urlStart + 8);
  }

  // Turn the selected lines into a list, or back into plain lines.
  function listLines(input, numbered) {
    const v = input.value, s = input.selectionStart, e = input.selectionEnd;
    const start = v.lastIndexOf('\n', s - 1) + 1;
    let end = v.indexOf('\n', e > s && v.charAt(e - 1) === '\n' ? e - 1 : e);
    if (end < 0) end = v.length;
    const lines = v.slice(start, end).split('\n');
    const re = numbered ? NUMBER : BULLET;
    const already = lines.every(l => !l.trim() || re.test(l));
    let i = 0;
    const next = lines.map(l => {
      if (already) return l.replace(numbered ? /^\s*\d{1,3}[.)]\s+/ : /^\s*[-*•]\s+/, '');
      if (!l.trim() && lines.length > 1) return l;
      const bare = l.replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/, '');
      return (numbered ? (++i) + '. ' : '- ') + bare;
    }).join('\n');
    return apply(input, v.slice(0, start) + next + v.slice(end), start, start + next.length);
  }

  function toolbar(input, opts) {
    const multi = !!(opts && opts.block);
    const bar = document.createElement('div');
    bar.className = 'rt-toolbar';
    const buttons = [
      ['B', 'bold — **like this**', 'rt-bold', () => wrap(input, '**', 'bold')],
      ['I', 'italic — *like this*', 'rt-italic', () => wrap(input, '*', 'italic')],
      ['🔗', 'link — [label](https://…)', '', () => addLink(input)],
    ];
    if (multi) {
      buttons.push(['• list', 'bullets — start lines with "- "', '', () => listLines(input, false)]);
      buttons.push(['1. list', 'numbered list — start lines with "1. "', '', () => listLines(input, true)]);
    }
    buttons.forEach(([label, title, cls, act]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rt-btn' + (cls ? ' ' + cls : '');
      b.textContent = label;
      b.title = title;
      b.setAttribute('aria-label', title.split(' — ')[0]);
      // Keep the field's selection when the button is pressed.
      b.addEventListener('mousedown', ev => ev.preventDefault());
      b.addEventListener('click', act);
      bar.appendChild(b);
    });
    return bar;
  }

  return { render, toolbar, safeHref };
})();
