/** HTML fragments for showing rolls; the tray styles the class names. */
import type { Roll } from "./roll";
import { explosions } from "./rules";

export const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * A log entry's inner HTML: `.meta` (who, time), `.total`, and `.detail` with one `.die`
 * per die (`.s` sides, `.x` exploded links), the modifier, and a `.boomtag`.
 */
export function logEntryHtml(r: Roll): string {
  const n = explosions(r.dice);
  const time = new Date(r.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dice = r.dice
    .map((d) => {
      const chain = d.chain.map((v, i) => (i < d.chain.length - 1 ? `<span class="x">${v}</span>` : v)).join(" → ");
      return `<span class="die"><span class="s">d${d.sides}</span>${chain}</span>`;
    })
    .join("");
  const mod = r.modifier ? `<span>${r.modifier > 0 ? "+" : "−"}${Math.abs(r.modifier)}</span>` : "";
  const tag = n ? `<span class="boomtag">✦ ×${n}</span>` : "";
  return `
    <div class="meta"><b>${esc(r.who)}</b> · ${time}${r.explode ? "" : " · no explode"}</div>
    <div class="total">${r.total}</div>
    <div class="detail">${dice}${mod}${tag}</div>`;
}

/** The result banner's inner HTML: `.who`, `.n` (total), and `.boom` when anything exploded. */
export function bannerHtml(r: Roll): string {
  const n = explosions(r.dice);
  return `<span class="who">${esc(r.who)}</span><span class="n">${r.total}</span>${
    n ? `<span class="boom">✦ exploded${n > 1 ? ` ×${n}` : ""}</span>` : ""
  }`;
}
