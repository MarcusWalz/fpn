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

  // ---- quick title search over pages.json ----
  const input = document.getElementById("qs-input");
  const list = document.getElementById("qs-results");
  if (!input || !list) return;

  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  let pages = null, loading = null, items = [], active = -1;

  const load = () =>
    (loading ||= fetch(base + "pages.json")
      .then((r) => r.json())
      .then((d) => (pages = d.map((p) => ({ ...p, nt: norm(p.t), k: norm(p.t + " " + (p.c || "")) }))))
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
