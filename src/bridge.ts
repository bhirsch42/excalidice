/**
 * Events between the tray (isolated world, content.ts) and the page script (Excalidraw's world,
 * page.ts). Details are JSON strings: objects don't survive the trip between worlds.
 */
import type { Roll } from "./dice";

export const TO_PAGE = "excalidice:to-page";
export const FROM_PAGE = "excalidice:from-page";

/** Our message type on Excalidraw's collab channel, and its payload version. */
export const MESSAGE_TYPE = "EXCALIDICE_ROLL";
export const WIRE_VERSION = 1;

export type ToPage = { type: "hello" } | { type: "send"; roll: Roll };

export type FromPage =
  /** found: Excalidraw's collab code was located; ready: it's in a live room we can send to. */
  | { type: "status"; found: boolean; ready: boolean; roomId: string | null }
  /** A peer's roll, as received; the tray must sanitize it. */
  | { type: "roll"; roll: unknown }
  | { type: "sent"; id: string; ok: boolean }
  /** Excalidraw's viewport: screen = (scene + scroll) * zoom + offset. */
  | ({ type: "view" } & View);

export type View = { scrollX: number; scrollY: number; zoom: number; offsetLeft: number; offsetTop: number };
