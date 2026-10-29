/**
 * Excalidice: a dice tool on excalidraw.com's toolbar, with dice thrown across the whole board
 * on a transparent overlay. In a live collaboration, rolls travel over Excalidraw's own
 * encrypted channel (see page.ts), so everyone in the room sees the same dice land. Alone, or if
 * that channel can't be found, rolls stay on this machine.
 */
import { PLAYER_COLORS, bannerHtml, createRoll, explosions, logEntryHtml, sanitizeRoll, type Roll } from "./dice";
import { TableStage } from "./table/stage";
import { FROM_PAGE, TO_PAGE, type FromPage, type ToPage, type View } from "./bridge";

const DICE = [4, 6, 8, 10, 12, 20];
const LOG_SIZE = 6;
/** In a live collaboration, how long to wait for Excalidraw's channel before rolling unshared. */
const CHANNEL_WAIT_MS = 10_000;
/** Dice sweep off the board this long after the last roll lands. */
const CLEAR_AFTER_MS = 3500;

/**
 * Icons in Excalidraw's house style: Tabler-style 24px outlines with 1.5 strokes, in currentColor.
 */
const icon = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  dice: icon(
    '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r=".6" fill="currentColor"/><circle cx="15.5" cy="8.5" r=".6" fill="currentColor"/><circle cx="12" cy="12" r=".6" fill="currentColor"/><circle cx="8.5" cy="15.5" r=".6" fill="currentColor"/><circle cx="15.5" cy="15.5" r=".6" fill="currentColor"/>',
  ),
};

// Colors, sizes and shadows are Excalidraw's own (its --island-bg-color, --color-surface-low,
// --color-primary, --shadow-island, help button), so the dice read as part of the app.
const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .root { --island: #ffffff; --surface: #ececf4; --surface-hi: #f1f0ff; --ink: #1b1b1f; --muted: #5c5c66; --line: #ececf4;
    --primary: #6965db; --primary-hi: #5b57d1; --primary-ink: #ffffff; --gold: #b7791f;
    --shadow: 0 0 1px 0 rgb(0 0 0 / .17), 0 0 3px 0 rgb(0 0 0 / .08), 0 7px 14px 0 rgb(0 0 0 / .05);
    position: fixed; inset: 0; pointer-events: none; font: 14px/1.4 Assistant, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: var(--ink); }
  .root.dark { --island: #232329; --surface: #232329; --surface-hi: #2e2d39; --ink: #e3e3e8; --muted: #9a9aa6; --line: #2e2d39;
    --primary: #a8a5ff; --primary-hi: #b2aeff; --primary-ink: #121212; --gold: #f2c55c; }
  .table { position: absolute; inset: 0; }
  button, input { font: inherit; color: inherit; }
  svg { width: 18px; height: 18px; display: block; }
  button { cursor: pointer; border: 0; background: var(--surface); border-radius: 8px; padding: 6px 0; }
  button:hover { background: var(--surface-hi); }
  .icon-btn { width: 38px; height: 38px; padding: 10px; display: grid; place-items: center; }
  /* Fallback when there's no top toolbar to dock into (Excalidraw's phone layout): stacked
     above Excalidraw's own help button, which sits at bottom 16px, right 16px. */
  .fab[hidden] { display: none; }
  .fab { pointer-events: auto; position: absolute; right: 16px; bottom: 62px; box-shadow: 0 0 0 1px var(--island); }
  .fab[aria-expanded=true] { background: var(--primary); color: var(--primary-ink); }
  /* placed under the toolbar's dice island by placePanel(); these are the fallback spot */
  .panel { pointer-events: auto; position: absolute; right: 16px; bottom: 108px; width: 264px; padding: 12px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px;
    background: var(--island); border-radius: 8px; box-shadow: var(--shadow); }
  .panel[hidden] { display: none; }
  .status { font-size: 12px; color: var(--muted); margin-left: auto; }
  .dice { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
  .dice button { font-weight: 600; font-size: 13px; padding: 8px 0; }
  button.primary { background: var(--primary); color: var(--primary-ink); padding: 6px 12px; font-weight: 600; }
  button.primary:hover { background: var(--primary-hi); }
  .row { display: flex; gap: 6px; align-items: center; }
  .row input[type=text] { flex: 1; }
  input[type=text] { border: 1px solid var(--line); background: var(--island); border-radius: 8px; padding: 5px 8px; min-width: 0; outline: none; }
  input[type=text]:focus { border-color: var(--primary); }
  input[type=checkbox] { accent-color: var(--primary); margin: 0; }
  label { display: inline-flex; gap: 6px; align-items: center; user-select: none; font-size: 13px; }
  .swatch { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--island); box-shadow: 0 0 0 1px var(--line); padding: 0; flex: none; }
  .err { color: #e03131; font-size: 12px; }
  .err:empty { display: none; }
  .note { font-size: 12px; color: var(--muted); }
  .note:empty { display: none; }
  .log { display: grid; gap: 5px; max-height: 210px; overflow-y: auto; }
  .entry { background: var(--surface); border-left: 3px solid var(--c); border-radius: 8px; padding: 5px 8px; display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; }
  .entry .meta { font-size: 11px; color: var(--muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entry .meta b { color: var(--ink); }
  .entry .total { grid-row: span 2; align-self: center; font-size: 20px; font-weight: 700; }
  .entry .detail { display: flex; flex-wrap: wrap; gap: 3px; font-size: 12px; }
  .die { background: var(--island); border-radius: 6px; padding: 0 4px; }
  .die .s { color: var(--muted); font-size: 9px; margin-right: 2px; }
  .die .x, .boomtag { color: var(--gold); font-weight: 700; }
  .toast { position: absolute; left: 50%; top: 104px; translate: -50% 0; display: flex; gap: 8px; align-items: center; padding: 8px 14px; line-height: 1;
    border-radius: 8px; background: var(--island); box-shadow: var(--shadow); white-space: nowrap; opacity: 0; transition: opacity .3s; }
  .toast.show { opacity: 1; }
  .toast .who { font-size: 13px; color: var(--muted); }
  /* the total in the roller's dice color */
  .toast .n { font-size: 18px; font-weight: 700; color: var(--c); }
  .toast .boom { font-size: 12px; color: var(--muted); }
`;

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

/**
 * The name this person goes by in Excalidraw's live collaboration. Excalidraw keeps it in
 * localStorage and picks a random one ("Authentic Wallaby") until they set their own.
 */
function excalidrawUsername(): string {
  try {
    return String(JSON.parse(localStorage.getItem("excalidraw-collab") ?? "{}").username ?? "").slice(0, 24) || "Someone";
  } catch {
    return "Someone";
  }
}

function mount() {
  const host = document.createElement("div");
  host.id = "excalidice";
  Object.assign(host.style, { position: "fixed", inset: "0", zIndex: "2147483000", pointerEvents: "none" });
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>${CSS}</style>
    <div class="root">
      <div class="table"></div>
      <div class="toast"></div>
      <div class="panel" hidden>
        <div class="dice">${DICE.map((d) => `<button data-d="${d}">d${d}</button>`).join("")}</div>
        <div class="row">
          <button type="button" class="swatch" title="Your dice color"></button>
          <label><input type="checkbox" class="explode" checked> Exploding 💥</label>
          <span class="status"></span>
        </div>
        <form class="row custom"><input type="text" class="expr" placeholder="2d6+1, d4+d8…" autocomplete="off"><button class="primary">Roll</button></form>
        <div class="err"></div>
        <div class="note"></div>
        <div class="log"></div>
      </div>
      <button class="fab icon-btn" title="Dice" aria-expanded="false">${ICONS.dice}</button>
    </div>`;
  const q = <T extends Element = HTMLElement>(sel: string) => shadow.querySelector(sel) as T;
  return { host, q };
}

async function main() {
  const { q } = mount();
  const root = q(".root");
  const panel = q(".panel");
  const err = q(".err");
  const swatch = q<HTMLButtonElement>(".swatch");

  const syncTheme = () => root.classList.toggle("dark", !!document.querySelector(".excalidraw.theme--dark"));
  syncTheme();
  new MutationObserver(syncTheme).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });

  const me = {
    name: excalidrawUsername(),
    color: store.get("excalidice.color") || PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)]!,
  };
  swatch.style.background = me.color;

  // The dice pan and zoom with the board: each roll lands where the board was when it was thrown,
  // and follows that spot as the viewport moves, as a CSS transform on the whole table.
  const table = q(".table");
  let view: View | null = null;
  let anchor: View | null = null;
  const follow = () => {
    if (!view || !anchor) return void (table.style.transform = "");
    const k = view.zoom / anchor.zoom;
    const tx = (view.scrollX - anchor.scrollX) * view.zoom;
    const ty = (view.scrollY - anchor.scrollY) * view.zoom;
    table.style.transformOrigin = `${view.offsetLeft}px ${view.offsetTop}px`;
    table.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
  };

  // Explosions in Excalidraw's own plain style: its default stroke color and purple accent.
  const stage = new TableStage(table, {
    onThrow: () => {
      anchor = view;
      follow();
    },
    viewHalfMin: 16,
    shadowOpacity: 0.22,
    palette: () =>
      root.classList.contains("dark") ? { ink: "#e3e3e8", accent: "#a8a5ff" } : { ink: "#1e1e1e", accent: "#6965db" },
  });
  stage.warmup();

  // The dice live in their own island at the left end of Excalidraw's top toolbar, the way the
  // laser pointer gets an island at the right end during a live collaboration. React owns that
  // container and can rebuild it (theme, zen mode, layout changes), so keep re-docking.
  const island = document.createElement("div");
  island.className = "Island excalidice";
  // Mirrors Excalidraw's laser island (LayerUI.tsx): an unpadded Island with
  // `marginLeft: 8, alignSelf: "center", height: "fit-content"`, holding a small toggle
  // IconButton whose icon is --default-button-size square (ToolIcon.scss).
  Object.assign(island.style, { marginRight: "8px", alignSelf: "center", height: "fit-content" });
  island.innerHTML = `<button type="button" class="ToolIcon ToolIcon_type_toggle ToolIcon_size_small" title="Dice" aria-label="Dice" aria-pressed="false"><div class="ToolIcon__icon" aria-hidden="true" style="width: var(--default-button-size); height: var(--default-button-size)">${ICONS.dice}</div></button>`;
  const islandButton = island.querySelector("button")!;
  const fab = q<HTMLButtonElement>(".fab");

  const placePanel = () => {
    if (island.isConnected) {
      const r = island.getBoundingClientRect();
      Object.assign(panel.style, { top: `${r.bottom + 8}px`, left: `${r.left}px`, right: "auto", bottom: "auto" });
    } else Object.assign(panel.style, { top: "", left: "", right: "", bottom: "" });
  };
  const dock = () => {
    const container = document.querySelector(".App-toolbar-container");
    if (container && island.parentElement !== container) container.prepend(island);
    else if (!container) island.remove();
    fab.hidden = island.isConnected;
    if (!panel.hidden) placePanel();
  };
  let dockQueued = false;
  new MutationObserver(() => {
    if (dockQueued) return;
    dockQueued = true;
    requestAnimationFrame(() => {
      dockQueued = false;
      dock();
    });
  }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", () => !panel.hidden && placePanel());
  dock();

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    if (open) placePanel();
    islandButton.classList.toggle("ToolIcon--checked", open);
    islandButton.setAttribute("aria-pressed", String(open));
    fab.setAttribute("aria-expanded", String(open));
  };
  islandButton.onclick = () => setOpen(panel.hidden);
  fab.onclick = () => setOpen(panel.hidden);
  // Like Excalidraw's own popovers, a press anywhere else closes the tray. Capture phase, so the
  // canvas can't swallow it first; the dice button is excluded so it can toggle.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (panel.hidden) return;
      const path = e.composedPath();
      if (!path.includes(panel) && !path.includes(islandButton) && !path.includes(fab)) setOpen(false);
    },
    true,
  );
  // Escape closes the tray from anywhere. Capture phase on window, ahead of Excalidraw's own
  // keyboard handling; the tray's fields stop key events (below), so this runs before that too.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || panel.hidden) return;
      e.stopPropagation();
      setOpen(false);
    },
    true,
  );

  swatch.onclick = () => {
    me.color = PLAYER_COLORS[(PLAYER_COLORS.indexOf(me.color) + 1) % PLAYER_COLORS.length]!;
    swatch.style.background = me.color;
    store.set("excalidice.color", me.color);
  };

  const roll = (expr: string) => {
    // the name is whatever Excalidraw's collaboration name is right now
    me.name = excalidrawUsername();
    const explode = q<HTMLInputElement>(".explode").checked;
    err.textContent = "";
    if (mode === "waiting") {
      err.textContent = "Still connecting to the live collaboration…";
      return;
    }
    const r = createRoll(expr, { who: me.name, color: me.color, explode });
    if (!r) {
      err.textContent = "Couldn't read that roll. Try 2d6+1 or d20.";
      return;
    }
    if (mode === "excalidraw") toPage({ type: "send", roll: r });
    void play(r);
    // get the tray out of the way of the dice
    setOpen(false);
  };
  for (const b of q(".dice").querySelectorAll<HTMLButtonElement>("button")) b.onclick = () => roll(`d${b.dataset.d}`);
  q<HTMLFormElement>(".custom").onsubmit = (e) => {
    e.preventDefault();
    const v = q<HTMLInputElement>(".expr").value.trim();
    if (v) roll(v);
  };
  // Excalidraw's keyboard shortcuts listen on the document; keep typing in the tray from triggering them.
  for (const ev of ["keydown", "keyup", "keypress"]) panel.addEventListener(ev, (e) => e.stopPropagation());

  const log = q(".log");
  const addLog = (r: Roll) => {
    const el = document.createElement("div");
    el.className = `entry${explosions(r.dice) ? " boom" : ""}`;
    el.style.setProperty("--c", r.color);
    el.innerHTML = logEntryHtml(r);
    log.prepend(el);
    while (log.children.length > LOG_SIZE) log.lastElementChild!.remove();
  };

  const toast = q(".toast");
  let clearTimer: ReturnType<typeof setTimeout> | undefined;
  const seen = new Set<string>();
  const play = async (r: Roll) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    clearTimeout(clearTimer);
    toast.classList.remove("show");
    await stage.show({ color: r.color, dice: r.dice });
    addLog(r);
    toast.innerHTML = bannerHtml(r);
    toast.style.setProperty("--c", r.color);
    toast.classList.add("show");
    clearTimer = setTimeout(() => {
      toast.classList.remove("show");
      void stage.clear();
    }, CLEAR_AFTER_MS);
  };

  /**
   * Where rolls go:
   * - local: no live collaboration; roll here, nobody else sees it.
   * - excalidraw: live collaboration; roll here and send it over Excalidraw's own channel.
   * - waiting: live collaboration, but the channel isn't up yet.
   * - unshared: the channel never came up (Excalidraw changed under us?); roll here only.
   */
  type Mode = "local" | "excalidraw" | "waiting" | "unshared";
  let mode: Mode = "local";
  let page = { found: false, ready: false };
  let sharedSince = 0;
  let currentHash: string | null = null;

  const toPage = (msg: ToPage) => window.dispatchEvent(new CustomEvent(TO_PAGE, { detail: JSON.stringify(msg) }));
  window.addEventListener(FROM_PAGE, (e) => {
    let msg: FromPage;
    try {
      msg = JSON.parse((e as CustomEvent<string>).detail);
    } catch {
      return;
    }
    if (msg.type === "status") {
      page = msg;
      update();
    } else if (msg.type === "roll" && mode === "excalidraw") {
      const r = sanitizeRoll(msg.roll);
      if (r) void play(r);
    } else if (msg.type === "view") {
      view = msg;
      follow();
    } else if (msg.type === "sent" && !msg.ok) {
      err.textContent = "That roll didn't reach the live collaboration.";
    }
  });

  const statusText: Record<Mode, string> = { local: "", excalidraw: "", waiting: "connecting…", unshared: "not shared" };

  const update = () => {
    const shared = /^#room=[\w-]+,/.test(location.hash);
    if (location.hash !== currentHash) {
      currentHash = location.hash;
      sharedSince = Date.now();
      log.innerHTML = "";
    }
    const next: Mode = !shared
      ? "local"
      : page.ready
        ? "excalidraw"
        : Date.now() - sharedSince > CHANNEL_WAIT_MS
          ? "unshared"
          : "waiting";
    q(".note").innerHTML = next === "local" ? "Just you. Start a <b>live collaboration</b> to roll together." : "";
    q(".status").textContent = statusText[next];
    mode = next;
  };
  window.addEventListener("hashchange", () => update());
  setInterval(() => update(), 1000);
  toPage({ type: "hello" });
  update();
}

void main();
