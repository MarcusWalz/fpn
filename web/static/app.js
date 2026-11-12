// fpn client: quick title search, sidebar panels, menu. Pages work without it.
(() => {
  const base = document.documentElement.dataset.base || "/";

  // Sidebar panels start collapsed (good on phones); open them on wide screens.
  if (matchMedia("(min-width: 960px)").matches) {
    document.querySelectorAll("details[data-auto-open]").forEach((d) => (d.open = true));
  }

  // Close the books menu on outside click or Escape.
  const menu = document.querySelector("details.menu");
  if (menu) {
    document.addEventListener("click", (e) => {
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && menu.open) { menu.open = false; menu.querySelector("summary").focus(); }
    });
  }

  // ---- collapsible sections ----
  // Every heading folds the content under it (down to the next heading of
  // the same or a higher level). Pages open with everything collapsed;
  // "Expand all" / "Collapse all" sit above the first heading. Links to a
  // spot inside a collapsed section (contents, citations, "Linked from")
  // open the sections around it. Not in the editor preview, which shows the
  // whole page so it can scroll with the text.
  const article = document.querySelector("article.prose");
  let reveal = () => {};
  if (article && location.protocol !== "about:") {
    const lvl = (el) => +((/^H([2-6])$/.exec(el.tagName) || [])[1] || 0);
    const heads = [...article.children].filter(lvl);
    const setFolded = (h, v) => { h.dataset.folded = v ? "1" : ""; h.querySelector(".fold-btn").setAttribute("aria-expanded", String(!v)); };
    const update = () => {
      const stack = [];
      for (const el of article.children) {
        const L = lvl(el);
        if (L) while (stack.length && stack[stack.length - 1] >= L) stack.pop();
        if (stack.length) { if (!el.hidden) el.setAttribute("hidden", "until-found"); }
        else el.removeAttribute("hidden");
        if (L && el.dataset.folded) stack.push(L);
      }
    };
    reveal = (el) => {
      let b = el;
      while (b && b.parentElement !== article) b = b.parentElement;
      if (!b) return;
      let L = lvl(b) || 7;
      if (lvl(b)) setFolded(b, false);
      for (let p = b.previousElementSibling; p; p = p.previousElementSibling) {
        const pl = lvl(p);
        if (pl && pl < L) { setFolded(p, false); L = pl; }
      }
      update();
    };
    if (heads.length) {
      heads.forEach((h) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "fold-btn";
        if (h.querySelector("a, button")) { btn.classList.add("fold-icon"); btn.setAttribute("aria-label", "Show or hide this section"); h.prepend(btn); }
        else { btn.append(...h.childNodes); h.append(btn); }
        btn.addEventListener("click", () => { setFolded(h, !h.dataset.folded); update(); });
        setFolded(h, true);
      });
      const tools = document.createElement("div");
      tools.className = "fold-tools";
      for (const [label, folded] of [["Expand all", false], ["Collapse all", true]]) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.addEventListener("click", () => { heads.forEach((h) => setFolded(h, folded)); update(); });
        tools.append(b);
      }
      heads[0].before(tools);
      update();
      // Browser find (Cmd+F) opens the section a match is in.
      article.addEventListener("beforematch", (e) => reveal(e.target));
      // Same-page links (contents, citations): open the section first.
      document.addEventListener("click", (e) => {
        const a = e.target.closest && e.target.closest('a[href^="#"]');
        const t = a && document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1)));
        if (t && article.contains(t)) reveal(t);
      }, true);
      const fromHash = () => {
        const t = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)));
        if (t && article.contains(t)) { reveal(t); t.scrollIntoView(); }
      };
      fromHash();
      addEventListener("hashchange", fromHash);
    }
  }

  // ---- "Linked from" → the spot on that page where the link is ----
  // Clicking a page in "← Linked from" opens it at its link to this page
  // (#link-to=<this page>), and briefly highlights the linked words there.
  const norm1 = (p) => decodeURIComponent(p).replace(/\/?$/, "/");
  document.querySelectorAll(".links-from a[href]").forEach((a) => {
    const u = new URL(a.href, location.href);
    u.hash = "link-to=" + encodeURIComponent(location.pathname);
    a.href = u.pathname + u.search + u.hash;
  });
  const showLink = () => {
    const m = /^#link-to=(.+)$/.exec(location.hash);
    if (!m) return;
    const target = norm1(decodeURIComponent(m[1]));
    const hits = [...document.querySelectorAll(".prose a[href]")].filter((a) =>
      !a.closest(".links-panel") && a.origin === location.origin && norm1(a.pathname) === target);
    history.replaceState(null, "", location.pathname + location.search);
    if (!hits.length) return;
    hits.forEach((a) => { reveal(a); for (let d = a.closest("details"); d; d = d.parentElement.closest("details")) d.open = true; });
    hits[0].scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    hits.forEach((a) => a.classList.add("link-flash"));
    setTimeout(() => hits.forEach((a) => a.classList.remove("link-flash")), 2600);
  };
  showLink();
  addEventListener("hashchange", showLink);

  // ---- quick title search over pages.json ----
  const input = document.getElementById("qs-input");
  const list = document.getElementById("qs-results");
  if (!input || !list) return;

  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  let pages = null, loading = null, items = [], active = -1;

  const load = () =>
    (loading ||= fetch(base + "pages.json")
      .then((r) => r.json())
      .then((d) => (pages = d.map((p) => ({ ...p, nt: norm(p.t), na: (p.a || []).map(norm), k: norm([p.t, ...(p.a || []), p.c || ""].join(" ")) }))))
      .catch(() => (pages = [])));

  function search(q) {
    const terms = norm(q).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const whole = terms.join(" ");
    const scored = [];
    for (const p of pages) {
      if (!terms.every((w) => p.k.includes(w))) continue;
      let s = 0;
      if (p.nt === whole) s += 100;
      if (p.na.includes(whole)) s += 100; // exact alias, e.g. "PMOS"
      else if (p.na.some((a) => a.startsWith(whole))) s += 40;
      if (p.nt.startsWith(whole)) s += 40;
      if (terms.every((w) => p.nt.includes(w))) s += 20;
      if (p.nt.split(/\W+/).some((w) => w.startsWith(terms[0]))) s += 10;
      if (p.s) s += 2;
      if (!p.p) s += 1;
      s -= p.nt.length / 200;
      scored.push([s, p]);
    }
    return scored.sort((a, b) => b[0] - a[0]).slice(0, 12).map((x) => x[1]);
  }

  function highlight(el, title, terms) {
    const nt = norm(title);
    const marks = new Array(title.length).fill(false);
    for (const w of terms) {
      let i = nt.indexOf(w);
      while (w && i !== -1) { for (let j = i; j < i + w.length; j++) marks[j] = true; i = nt.indexOf(w, i + w.length); }
    }
    let run = "", on = false;
    const flush = () => {
      if (!run) return;
      if (on) { const m = document.createElement("mark"); m.textContent = run; el.append(m); }
      else el.append(run);
      run = "";
    };
    for (let i = 0; i < title.length; i++) {
      if (marks[i] !== on) { flush(); on = marks[i]; }
      run += title[i];
    }
    flush();
  }

  function render(q) {
    items = pages ? search(q) : [];
    active = -1;
    list.replaceChildren();
    if (!q.trim()) { close(); return; }
    if (!items.length) {
      const li = document.createElement("li");
      li.className = "qs-empty";
      li.textContent = "No matching titles";
      list.append(li);
    }
    const terms = norm(q).split(/\s+/).filter(Boolean);
    items.forEach((p, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.id = "qs-opt-" + i;
      const a = document.createElement("a");
      a.href = p.u;
      highlight(a, p.t, terms);
      const alias = p.a && p.a.find((x, j) => terms.some((w) => p.na[j].includes(w)));
      if (alias) { const al = document.createElement("span"); al.className = "qs-alias"; al.append(" ("); highlight(al, alias, terms); al.append(")"); a.append(al); }
      if (p.s) { const t = document.createElement("span"); t.className = "sec-tag"; t.textContent = "SECTION"; a.append(t); }
      if (p.p) { a.classList.add("stub"); const t = document.createElement("span"); t.className = "sec-tag"; t.textContent = "STUB"; a.append(t); }
      if (p.c) { const sm = document.createElement("small"); sm.textContent = p.c; a.append(sm); }
      li.append(a);
      list.append(li);
    });
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function close() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function setActive(i) {
    const opts = list.querySelectorAll('[role="option"]');
    if (!opts.length) return;
    active = (i + opts.length) % opts.length;
    opts.forEach((o, j) => o.setAttribute("aria-selected", j === active ? "true" : "false"));
    opts[active].scrollIntoView({ block: "nearest" });
    input.setAttribute("aria-activedescendant", opts[active].id);
  }

  input.addEventListener("focus", load, { once: true });
  input.addEventListener("input", async () => { await load(); render(input.value); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
    else if (e.key === "Enter") {
      const p = items[active >= 0 ? active : 0];
      if (p) { e.preventDefault(); location.href = p.u; }
    } else if (e.key === "Escape") { input.value = ""; close(); }
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".qs")) close(); });

  // "/" focuses search, like many docs sites.
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/^(input|textarea|select)$/i.test(document.activeElement.tagName)) {
      e.preventDefault(); input.focus();
    }
  });
})();
