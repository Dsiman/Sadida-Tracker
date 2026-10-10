// Card Library for the mod tracker site (SAD-0013). Data comes from <Mod>/deck.json, written by the
// in-game exporter (`py scripts/harness.py export`); mods.json lists which mods have one.
"use strict";

const TYPE_ORDER = ["Attack", "Skill", "Power", "Summon"];
const RARITY_ORDER = ["Basic", "Common", "Uncommon", "Rare", "Ancient", "Event", "Token", "Status", "Curse", "Quest"];
const COSTS = ["0", "1", "2", "3+", "X", "Unplayable"];
const SORTS = [["type", "Type"], ["rarity", "Rarity"], ["cost", "Cost"], ["name", "A–Z"]];
const MULTI = "Multiplayer";
const STORE = "deck-viewer:";

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
};
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(STORE + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(STORE + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const state = {
  mods: [], mod: null, deck: null, cards: [], byId: new Map(),
  q: "", off: { type: new Set(), rarity: new Set(), cost: new Set() },
  sort: [{ key: "type", dir: 1 }, { key: "rarity", dir: 1 }, { key: "cost", dir: 1 }, { key: "name", dir: 1 }],
  showUp: false, visible: [], inspect: -1, inspectUp: false,
  lineupMode: false, lineup: [],
};

// ── data ────────────────────────────────────────────────────────────────────

const typeGroup = (c) => (TYPE_ORDER.includes(c.type) ? c.type : "Other");
const costGroup = (cost) => (cost === "X" ? "X" : cost < 0 ? "Unplayable" : cost >= 3 ? "3+" : String(cost));
const isMulti = (c) => c.multiplayer === "MultiplayerOnly";
const shortId = (id) => id.replace(new RegExp(`^${state.mod.toUpperCase()}-`), "");
const variant = (c, up) => (up && c.upgrade ? { ...c, ...c.upgrade, up: true } : { ...c, up: false });
const src = (path) => `${state.mod}/${path}`;

async function loadMods() {
  const res = await fetch("mods.json", { cache: "no-cache" });
  state.mods = await res.json();
  const params = new URLSearchParams(location.hash.slice(1));
  const wanted = params.get("mod") || store.get("mod", null);
  const mod = state.mods.find((m) => m.mod === wanted) ? wanted : state.mods[0]?.mod;
  renderTabs();
  if (mod) await loadDeck(mod);
  else $("#sub").textContent = "No cards have been exported yet.";
}

async function loadDeck(mod) {
  state.mod = mod;
  store.set("mod", mod);
  const res = await fetch(`${mod}/deck.json`, { cache: "no-cache" });
  state.deck = await res.json();
  state.cards = state.deck.cards;
  state.byId = new Map(state.cards.map((c) => [c.id, c]));
  const [w, h] = state.deck.cardSize;
  document.documentElement.style.setProperty("--card-ratio", `${w} / ${h}`);
  document.title = `${mod} Card Library`;
  $("#heading").textContent = `${mod} Card Library`;
  $("#sub").textContent = `${state.cards.length} cards · ${state.deck.version}`;
  state.off = store.get(`off:${mod}`, null)
    ? Object.fromEntries(Object.entries(store.get(`off:${mod}`)).map(([k, v]) => [k, new Set(v)]))
    : { type: new Set(), rarity: new Set(), cost: new Set() };
  state.lineup = [];
  renderTabs();
  renderFilters();
  readHash();
  renderGrid();
  renderTray();
}

// ── filters and sorting ─────────────────────────────────────────────────────

function present(key) {
  const seen = new Set();
  for (const c of state.cards) {
    if (key === "type") seen.add(typeGroup(c));
    if (key === "rarity") { seen.add(c.rarity); if (isMulti(c)) seen.add(MULTI); }
    if (key === "cost") seen.add(costGroup(c.cost));
  }
  const order = { type: [...TYPE_ORDER, "Other"], rarity: [...RARITY_ORDER, "None", MULTI], cost: COSTS }[key];
  return [...seen].sort((a, b) => rank(order, a) - rank(order, b));
}

const rank = (order, v) => (order.indexOf(v) === -1 ? order.length : order.indexOf(v));

function renderFilters() {
  for (const key of ["type", "rarity", "cost"]) {
    const g = $(`#g-${key}`);
    g.querySelectorAll(".chip").forEach((n) => n.remove());
    for (const value of present(key)) {
      const chip = el("button", { type: "button", className: "chip", textContent: value });
      chip.setAttribute("aria-pressed", String(!state.off[key].has(value)));
      chip.title = "Click to show or hide. Double-click to show only this.";
      chip.onclick = () => {
        state.off[key].has(value) ? state.off[key].delete(value) : state.off[key].add(value);
        chip.setAttribute("aria-pressed", String(!state.off[key].has(value)));
        saveFilters();
        renderGrid();
      };
      chip.ondblclick = () => {
        state.off[key] = new Set(present(key).filter((v) => v !== value));
        saveFilters();
        renderFilters();
        renderGrid();
      };
      g.append(chip);
    }
    g.querySelector(".glabel").onclick = () => {
      state.off[key].clear();
      saveFilters();
      renderFilters();
      renderGrid();
    };
  }
  const sorts = $("#g-sort");
  sorts.querySelectorAll(".chip").forEach((n) => n.remove());
  for (const [key, label] of SORTS) {
    const first = state.sort[0].key === key;
    const chip = el("button", { type: "button", className: "chip sort" + (first && state.sort[0].dir < 0 ? " desc" : ""), textContent: label });
    chip.setAttribute("aria-pressed", String(first));
    chip.onclick = () => {
      if (first) state.sort[0].dir *= -1;
      else state.sort = [{ key, dir: 1 }, ...state.sort.filter((s) => s.key !== key)];
      renderFilters();
      renderGrid();
    };
    sorts.append(chip);
  }
}

function saveFilters() {
  store.set(`off:${state.mod}`, Object.fromEntries(Object.entries(state.off).map(([k, v]) => [k, [...v]])));
}

function passes(c) {
  if (state.off.type.has(typeGroup(c)) || state.off.rarity.has(c.rarity) || state.off.cost.has(costGroup(c.cost))) return false;
  if (isMulti(c) && state.off.rarity.has(MULTI)) return false;
  if (!state.q) return true;
  const hay = [c.title, c.text, c.upgrade?.text, c.type, c.rarity, shortId(c.id)].join(" ").toLowerCase();
  return state.q.split(/\s+/).every((w) => hay.includes(w));
}

function compare(a, b) {
  for (const { key, dir } of state.sort) {
    let d = 0;
    if (key === "type") d = rank(TYPE_ORDER, a.type) - rank(TYPE_ORDER, b.type);
    if (key === "rarity") d = rank(RARITY_ORDER, a.rarity) - rank(RARITY_ORDER, b.rarity);
    if (key === "cost") d = (a.cost === "X" ? 99 : a.cost) - (b.cost === "X" ? 99 : b.cost);
    if (key === "name") d = a.title.localeCompare(b.title);
    if (d) return d * dir;
  }
  return 0;
}

// ── grid ────────────────────────────────────────────────────────────────────

function renderGrid() {
  state.visible = state.cards.filter(passes).sort(compare);
  const grid = $("#grid");
  grid.replaceChildren();
  const counts = lineupCounts();
  for (const [i, c] of state.visible.entries()) {
    const v = variant(c, state.showUp);
    const img = el("img", { src: src(v.img), alt: v.title, loading: "lazy", decoding: "async" });
    const tile = el("button", { type: "button", className: "tile", title: v.title }, img);
    if (state.lineupMode && counts.get(c.id)) tile.append(el("span", { className: "added", textContent: counts.get(c.id) }));
    tile.onclick = (e) => (state.lineupMode && !e.shiftKey ? addToLineup(c.id, state.showUp && !!c.upgrade) : openInspect(i, state.showUp));
    grid.append(tile);
  }
  if (!state.visible.length) grid.append(el("p", { className: "empty", textContent: "No cards match these filters." }));
  $("#count").textContent = `Showing ${state.visible.length} of ${state.cards.length} cards`;
}

// ── inspect ─────────────────────────────────────────────────────────────────

function openInspect(index, up) {
  state.inspect = index;
  state.inspectUp = up;
  $("#inspect").hidden = false;
  document.body.style.overflow = "hidden";
  renderInspect();
}

function closeInspect() {
  state.inspect = -1;
  $("#inspect").hidden = true;
  document.body.style.overflow = "";
  history.replaceState(null, "", location.pathname + location.search + (state.lineup.length ? lineupHash() : ""));
}

function renderInspect() {
  const c = state.visible[state.inspect];
  if (!c) return closeInspect();
  const v = variant(c, state.inspectUp);
  $("#big-img").src = src(v.img);
  $("#big-img").alt = v.title;
  $("#up-wrap").hidden = !c.upgrade;
  $("#up-tick").checked = v.up;
  $("#prev").hidden = state.inspect === 0;
  $("#next").hidden = state.inspect === state.visible.length - 1;
  $("#add-lineup").hidden = false;
  const tips = $("#tips");
  tips.replaceChildren();
  for (const key of v.tips || []) {
    const t = state.deck.tips[key];
    if (!t) continue;
    if (t.card) {
      tips.append(el("div", { className: "tip cardtip" }, el("img", { src: src(t.card), alt: t.title, loading: "lazy" })));
    } else {
      const h = el("h3");
      if (t.icon) h.append(el("img", { src: src(t.icon), alt: "" }));
      h.append(t.title || "");
      const p = el("p");
      p.innerHTML = bbcode(t.text);
      tips.append(el("div", { className: "tip" + (t.debuff ? " debuff" : "") }, h, p));
    }
  }
  history.replaceState(null, "", `#mod=${state.mod}&card=${shortId(c.id)}${v.up ? "%2B" : ""}`);
}

function bbcode(text) {
  const esc = (text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/\[(gold|blue|green|red|purple|orange|aqua|pink)\]/g, '<span class="c-$1">')
    .replace(/\[\/(gold|blue|green|red|purple|orange|aqua|pink)\]/g, "</span>")
    .replace(/\[(\/?)(b|i)\]/g, "<$1$2>")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\n/g, "<br>");
}

// ── lineup ──────────────────────────────────────────────────────────────────

const lineupCounts = () => state.lineup.reduce((m, s) => m.set(s.id, (m.get(s.id) || 0) + 1), new Map());

function setLineupMode(on) {
  state.lineupMode = on;
  $("#lineup-toggle").setAttribute("aria-pressed", String(on));
  $("#lineup-hint").hidden = !on;
  $("#drawer").hidden = !on;
  document.body.classList.toggle("drawer-open", on);
  renderGrid();
  if (on) drawLineup();
}

function addToLineup(id, up) {
  state.lineup.push({ id, up });
  if (!state.lineupMode) setLineupMode(true);
  renderTray();
  renderGrid();
}

function renderTray() {
  const tray = $("#tray");
  tray.replaceChildren();
  state.lineup.forEach((slot, i) => {
    const c = state.byId.get(slot.id);
    if (!c) return;
    const v = variant(c, slot.up);
    const li = el("li", { draggable: true, title: v.title }, el("img", { src: src(v.img), alt: v.title }));
    const rm = el("button", { type: "button", textContent: "✕", title: "Remove" });
    rm.onclick = () => { state.lineup.splice(i, 1); renderTray(); renderGrid(); };
    li.append(rm);
    if (c.upgrade) {
      const up = el("button", { type: "button", className: "up", textContent: slot.up ? "+" : "−", title: "Toggle upgrade" });
      up.onclick = () => { slot.up = !slot.up; renderTray(); };
      li.append(up);
    }
    li.ondragstart = (e) => { li.classList.add("dragging"); e.dataTransfer.setData("text/plain", String(i)); };
    li.ondragend = () => li.classList.remove("dragging");
    li.ondragover = (e) => e.preventDefault();
    li.ondrop = (e) => {
      e.preventDefault();
      const from = Number(e.dataTransfer.getData("text/plain"));
      const [moved] = state.lineup.splice(from, 1);
      state.lineup.splice(i, 0, moved);
      renderTray();
    };
    tray.append(li);
  });
  $("#lineup-count").textContent = state.lineup.length ? `${state.lineup.length} card${state.lineup.length > 1 ? "s" : ""}` : "";
  if (state.lineupMode) {
    history.replaceState(null, "", location.pathname + location.search + (state.lineup.length ? lineupHash() : ""));
    drawLineup();
  }
}

const lineupHash = () =>
  `#mod=${state.mod}&lineup=${state.lineup.map((s) => shortId(s.id) + (s.up ? "%2B" : "")).join(",")}`;

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const resolve = (token) => {
    const up = token.endsWith("+");
    const id = `${state.mod.toUpperCase()}-${up ? token.slice(0, -1) : token}`;
    return state.byId.has(id) ? { id, up: up && !!state.byId.get(id).upgrade } : null;
  };
  if (params.get("lineup")) {
    state.lineup = params.get("lineup").split(",").map(resolve).filter(Boolean);
    if (state.lineup.length) setLineupMode(true);
  }
  if (params.get("card")) {
    const slot = resolve(params.get("card"));
    if (slot) {
      state.visible = state.cards.filter(passes).sort(compare);
      let i = state.visible.findIndex((c) => c.id === slot.id);
      if (i === -1) { state.visible = [...state.cards].sort(compare); i = state.visible.findIndex((c) => c.id === slot.id); }
      openInspect(i, slot.up);
    }
  }
}

// Options and drawing.
const images = new Map();
let bgImage = null;

function loadImage(url) {
  if (!images.has(url)) {
    images.set(url, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    }));
  }
  return images.get(url);
}

function opts() {
  const f = new FormData($("#opts"));
  const n = (k) => Number(f.get(k));
  return {
    layout: f.get("layout"), cols: Math.max(1, n("cols")), width: n("width"), gap: n("gap") / 100, curve: n("curve"),
    margin: n("margin"), bg: f.get("bg"), c1: f.get("c1"), c2: f.get("c2"), title: f.get("title").trim(), scale: n("scale"),
  };
}

function syncOpts() {
  const o = opts();
  for (const label of $("#opts").querySelectorAll("label[data-for]")) {
    const keys = label.dataset.for.split(" ");
    label.hidden = !keys.includes(o.layout) && !keys.includes(o.bg);
  }
  for (const out of $("#opts").querySelectorAll("output")) {
    const input = out.previousElementSibling;
    out.textContent = input.name === "gap" ? `${input.value}%` : input.value;
  }
  store.set("opts", Object.fromEntries([...new FormData($("#opts"))].filter(([k]) => k !== "bgfile")));
}

// Card rectangles (centre, rotation) in output pixels at 1x, before the margin is added.
function layout(o, count, w, h) {
  const step = w * (1 + o.gap);
  if (o.layout === "grid") {
    const rowStep = h * (1 + o.gap);
    return Array.from({ length: count }, (_, i) => ({ x: (i % o.cols) * step + w / 2, y: Math.floor(i / o.cols) * rowStep + h / 2, r: 0 }));
  }
  if (o.layout === "fan") {
    const radius = w * o.curve;
    const da = step / radius;
    return Array.from({ length: count }, (_, i) => {
      const a = (i - (count - 1) / 2) * da;
      return { x: radius * Math.sin(a), y: radius * (1 - Math.cos(a)), r: a };
    });
  }
  return Array.from({ length: count }, (_, i) => ({ x: i * step + w / 2, y: h / 2, r: 0 }));
}

let drawToken = 0;
async function drawLineup() {
  const token = ++drawToken;
  const o = opts();
  const canvas = $("#canvas");
  const ctx = canvas.getContext("2d");
  const slots = state.lineup.map((s) => variant(state.byId.get(s.id), s.up)).filter((v) => v.img);
  const pics = await Promise.all(slots.map((v) => loadImage(src(v.img))));
  if (token !== drawToken) return;
  if (o.title) await document.fonts.load(`700 48px Kreon`).catch(() => {});

  // Images are already trimmed to what's drawn (cost badges included), so draw them whole.
  const [sw, sh] = state.deck.cardSize;
  const w = o.width, h = (w * sh) / sw;
  const rects = layout(o, pics.length, w, h);

  let minX = 0, minY = 0, maxX = w, maxY = h;
  if (rects.length) {
    minX = minY = Infinity; maxX = maxY = -Infinity;
    for (const r of rects) {
      for (const [dx, dy] of [[-w / 2, -h / 2], [w / 2, -h / 2], [-w / 2, h / 2], [w / 2, h / 2]]) {
        const x = r.x + dx * Math.cos(r.r) - dy * Math.sin(r.r);
        const y = r.y + dx * Math.sin(r.r) + dy * Math.cos(r.r);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  const titleH = o.title ? 72 : 0;
  const width = maxX - minX + o.margin * 2;
  const height = maxY - minY + o.margin * 2 + titleH;
  const k = o.scale;
  canvas.width = Math.max(1, Math.round(width * k));
  canvas.height = Math.max(1, Math.round(height * k));
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.clearRect(0, 0, width, height);

  if (o.bg === "color") { ctx.fillStyle = o.c1; ctx.fillRect(0, 0, width, height); }
  if (o.bg === "gradient") {
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, o.c1); g.addColorStop(1, o.c2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
  }
  if (o.bg === "image" && bgImage) {
    const s = Math.max(width / bgImage.width, height / bgImage.height);
    ctx.drawImage(bgImage, (width - bgImage.width * s) / 2, (height - bgImage.height * s) / 2, bgImage.width * s, bgImage.height * s);
  }
  if (o.title) {
    ctx.font = "700 48px Kreon, Georgia, serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 8; ctx.strokeStyle = "#000"; ctx.lineJoin = "round";
    ctx.strokeText(o.title, width / 2, o.margin / 2 + titleH / 2);
    ctx.fillStyle = "#efc851";
    ctx.fillText(o.title, width / 2, o.margin / 2 + titleH / 2);
  }
  pics.forEach((img, i) => {
    const r = rects[i];
    ctx.save();
    ctx.translate(r.x - minX + o.margin, r.y - minY + o.margin + titleH);
    ctx.rotate(r.r);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  });
}

// ── tabs and wiring ─────────────────────────────────────────────────────────

function renderTabs() {
  const tabs = $("#tabs");
  tabs.replaceChildren();
  if (state.mods.length < 2) return;
  for (const m of state.mods) {
    const b = el("button", { type: "button", textContent: m.mod });
    b.setAttribute("aria-selected", String(m.mod === state.mod));
    b.onclick = () => m.mod !== state.mod && loadDeck(m.mod);
    tabs.append(b);
  }
}

function step(d) {
  const next = state.inspect + d;
  if (next >= 0 && next < state.visible.length) { state.inspect = next; renderInspect(); }
}

function wire() {
  let t;
  $("#q").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); renderGrid(); }, 120); };
  $("#show-up").checked = state.showUp = store.get("showUp", false);
  $("#show-up").onchange = (e) => { state.showUp = e.target.checked; store.set("showUp", state.showUp); renderGrid(); };
  $("#lineup-toggle").onclick = () => setLineupMode(!state.lineupMode);
  $("#prev").onclick = () => step(-1);
  $("#next").onclick = () => step(1);
  $("#up-tick").onchange = (e) => { state.inspectUp = e.target.checked; renderInspect(); };
  $("#add-lineup").onclick = () => {
    const c = state.visible[state.inspect];
    closeInspect();
    addToLineup(c.id, state.inspectUp && !!c.upgrade);
  };
  document.querySelectorAll("[data-close]").forEach((n) => (n.onclick = closeInspect));
  document.addEventListener("keydown", (e) => {
    if ($("#inspect").hidden) return;
    if (e.key === "Escape") closeInspect();
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
    if (e.key.toLowerCase() === "u" && state.visible[state.inspect]?.upgrade) { state.inspectUp = !state.inspectUp; renderInspect(); }
  });

  const form = $("#opts");
  for (const [k, v] of Object.entries(store.get("opts", {}))) if (form.elements[k] && k !== "bgfile") form.elements[k].value = v;
  form.elements.layout.onchange = (e) => {
    form.elements.gap.value = e.target.value === "fan" ? -25 : 4;
    syncOpts(); drawLineup();
  };
  form.oninput = (e) => { if (e.target.name !== "layout") { syncOpts(); drawLineup(); } };
  form.elements.bgfile.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => { bgImage = img; drawLineup(); };
    img.src = URL.createObjectURL(file);
  };
  syncOpts();

  $("#lineup-clear").onclick = () => { state.lineup = []; renderTray(); renderGrid(); };
  $("#drawer-min").onclick = (e) => {
    const min = $("#drawer").classList.toggle("min");
    e.target.textContent = min ? "▴" : "▾";
    document.body.classList.toggle("drawer-open", !min);
  };
  $("#lineup-link").onclick = async (e) => {
    const url = location.origin + location.pathname + lineupHash();
    try { await navigator.clipboard.writeText(url); e.target.textContent = "Copied"; }
    catch { prompt("Lineup link:", url); }
    setTimeout(() => (e.target.textContent = "Copy link"), 1500);
  };
  $("#lineup-png").onclick = async () => {
    await drawLineup();
    $("#canvas").toBlob((blob) => {
      const a = el("a", { href: URL.createObjectURL(blob), download: `${state.mod.toLowerCase()}-lineup.png` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  };
}

wire();
loadMods().catch((err) => {
  $("#sub").textContent = "Couldn't load the card data.";
  console.error(err);
});
