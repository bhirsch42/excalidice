/**
 * Runs in excalidraw.com's own JavaScript world (the manifest's `"world": "MAIN"`), because
 * that's the only place Excalidraw's collaboration socket can be reached. It sends and receives
 * dice rolls over that socket as a message type of our own; Excalidraw's receivers ignore
 * types they don't know. The tray, in the extension's isolated world, talks to this script with
 * window events carrying JSON strings (objects don't cross between worlds).
 *
 * Wire format, matching Excalidraw's own collab messages (excalidraw-app/collab/Portal.tsx):
 * `socket.emit("server-broadcast", roomId, ciphertext, iv)`, where the plaintext is
 * `JSON.stringify({ type: "EXCALIDICE_ROLL", payload: { v: 1, roll } })`, encrypted with
 * AES-GCM under the room key (128-bit, imported as a JWK) with a fresh 12-byte IV. The relay
 * forwards it to everyone else in the room as `client-broadcast`; the sender doesn't get it back.
 */
import { FROM_PAGE, MESSAGE_TYPE, TO_PAGE, WIRE_VERSION, type FromPage, type ToPage } from "./bridge";

type Socket = {
  connected: boolean;
  on(event: string, fn: (...args: any[]) => void): void;
  off(event: string, fn: (...args: any[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
};
/** The parts of Excalidraw's collab Portal we use; its property names survive minification. */
type Portal = { socket: Socket | null; roomId: string | null; roomKey: string | null };

/**
 * Walk React's fiber tree from Excalidraw's root container and return the first component
 * instance that `match` accepts. Production builds expose their components no other way.
 */
function findComponent(match: (instance: any) => boolean): any {
  const root = document.getElementById("root");
  if (!root) return null;
  const containerKey = Object.keys(root).find((k) => k.startsWith("__reactContainer$"));
  if (!containerKey) return null;
  const stack: any[] = [(root as any)[containerKey]];
  for (let visited = 0; stack.length && visited < 50_000; visited++) {
    const fiber = stack.pop();
    if (!fiber) continue;
    if (fiber.stateNode && match(fiber.stateNode)) return fiber.stateNode;
    if (fiber.sibling) stack.push(fiber.sibling);
    if (fiber.child) stack.push(fiber.child);
  }
  return null;
}

/** The Portal of Excalidraw's Collab component: the live room's socket, id and key. */
const findPortal = (): Portal | null =>
  findComponent((c) => {
    const p = c.portal;
    return !!p && typeof p === "object" && "socket" in p && "roomKey" in p && "roomId" in p;
  })?.portal ?? null;

/** Excalidraw's App component, whose state holds the viewport (scrollX, scrollY, zoom). */
const findApp = (): { state: any } | null =>
  findComponent((c) => typeof c.state?.scrollX === "number" && typeof c.state?.zoom?.value === "number");

const keys = new Map<string, Promise<CryptoKey>>();
const keyFor = (roomKey: string) => {
  if (!keys.has(roomKey)) {
    keys.set(
      roomKey,
      crypto.subtle.importKey(
        "jwk",
        { alg: "A128GCM", ext: true, k: roomKey, key_ops: ["encrypt", "decrypt"], kty: "oct" },
        { name: "AES-GCM", length: 128 },
        false,
        ["encrypt", "decrypt"],
      ),
    );
  }
  return keys.get(roomKey)!;
};

const post = (msg: FromPage) => window.dispatchEvent(new CustomEvent(FROM_PAGE, { detail: JSON.stringify(msg) }));

let portal: Portal | null = null;
let listening: Socket | null = null;
let lastStatus = "";

const onBroadcast = async (encrypted: ArrayBuffer, iv: ArrayBuffer | Uint8Array) => {
  const roomKey = portal?.roomKey;
  if (!roomKey) return;
  let data: any;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, await keyFor(roomKey), encrypted);
    data = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return; // not ours to worry about; Excalidraw handles its own messages
  }
  if (data?.type !== MESSAGE_TYPE || data.payload?.v !== WIRE_VERSION) return;
  post({ type: "roll", roll: data.payload.roll });
};

/** Keep our listener on whichever socket Excalidraw currently has, and report readiness. */
function sync() {
  // look again while not in a live room, in case Excalidraw remounted its collab component
  if (!portal?.socket?.connected) portal = findPortal() ?? portal;
  const socket = portal?.socket ?? null;
  if (socket !== listening) {
    listening?.off("client-broadcast", onBroadcast);
    socket?.on("client-broadcast", onBroadcast);
    listening = socket;
  }
  const ready = !!(socket?.connected && portal?.roomId && portal?.roomKey);
  const status = JSON.stringify({ found: !!portal, ready, roomId: ready ? portal!.roomId : null });
  if (status !== lastStatus) {
    lastStatus = status;
    post({ type: "status", found: !!portal, ready, roomId: ready ? portal!.roomId : null });
  }
}

window.addEventListener(TO_PAGE, async (e) => {
  let msg: ToPage;
  try {
    msg = JSON.parse((e as CustomEvent<string>).detail);
  } catch {
    return;
  }
  if (msg.type === "hello") {
    lastStatus = "";
    sync();
  } else if (msg.type === "send") {
    sync();
    const { socket, roomId, roomKey } = portal ?? {};
    if (!socket?.connected || !roomId || !roomKey) return post({ type: "sent", id: msg.roll.id, ok: false });
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify({ type: MESSAGE_TYPE, payload: { v: WIRE_VERSION, roll: msg.roll } }));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(roomKey), plain);
    socket.emit("server-broadcast", roomId, encrypted, iv);
    post({ type: "sent", id: msg.roll.id, ok: true });
  }
});

setInterval(sync, 1000);
sync();

// Report the viewport whenever it changes, so the tray can pan and zoom the dice with the board.
let app: { state: any } | null = null;
let lastView = "";
let lastFind = 0;
const watchView = (now: number) => {
  // look again now and then, in case Excalidraw remounted
  if (!app || now - lastFind > 2000) {
    app = findApp() ?? app;
    lastFind = now;
  }
  const st = app?.state;
  if (st) {
    const view = { scrollX: st.scrollX, scrollY: st.scrollY, zoom: st.zoom.value, offsetLeft: st.offsetLeft ?? 0, offsetTop: st.offsetTop ?? 0 };
    const key = JSON.stringify(view);
    if (key !== lastView) {
      lastView = key;
      post({ type: "view", ...view });
    }
  }
  requestAnimationFrame(watchView);
};
requestAnimationFrame(watchView);
