<p align="center"><img src="icons/icon-128.png" width="96" alt=""></p>

<h1 align="center">Excalidice</h1>

<p align="center">3D dice for <a href="https://excalidraw.com">Excalidraw</a>. Roll them across your board, and everyone in your live collaboration sees the same dice land.</p>

---

Excalidice is a Chrome extension that adds a dice tool to excalidraw.com, so you can run a tabletop game, a design-sprint vote or a lunch decision on the same board you're drawing on.

- **Real 3D dice**: d4, d6, d8, d10, d12 and d20 tumble across the whole board with physics, then sweep away a few seconds after they land.
- **Any notation**: click a die, or type something like `2d6+1` or `d4 + d8 - 2`.
- **Exploding dice**, as in *Kids on Bikes*: roll a die's maximum and a new die leaps out of it and rolls again, adding on, as many times as it keeps maxing out. Turn it off with one checkbox.
- **In step**: every roll takes the same time on every screen, explosions and all, so everyone sees the result at about the same moment.
- **Multiplayer with no server**: in a live collaboration, rolls travel over Excalidraw's own end-to-end encrypted channel. Everyone with the extension sees the same results; Excalidraw ignores the messages for anyone without it.
- **At home on the board**: the tool sits in Excalidraw's toolbar, explosions are drawn in Excalidraw's plain hand-drawn style, it follows light and dark mode, and the dice pan and zoom with the canvas.
- **Your name and color**: rolls carry your Excalidraw collaboration name and a dice color you pick.

## Install

Excalidice isn't in the Chrome Web Store yet. To install it from a release:

1. Download `excalidice-<version>.zip` from the [latest release](https://github.com/bhirsch42/excalidice/releases/latest) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the unzipped folder.
4. Open or reload [excalidraw.com](https://excalidraw.com).

It works in any Chromium browser that loads unpacked extensions (Chrome, Edge, Brave, Arc). To update, unzip the new release over the same folder and press the reload icon on the extension's card.

## Use

Click the dice button at the left end of Excalidraw's toolbar. Pick a die, or type notation and press **Roll**. The dot next to **Exploding** changes your dice color. Click outside the tray or press <kbd>Esc</kbd> to close it.

To roll together, start a **Live collaboration** in Excalidraw as usual. Everyone who has the extension sees every roll. On your own, rolls stay on your machine.

## How it works

Excalidraw's live collaboration sends encrypted messages through a relay that forwards anything to everyone else in the room. Excalidice finds Excalidraw's connection inside the page and sends each roll as one more encrypted message, with a message type of its own: `EXCALIDICE_ROLL`. Its encryption is exactly the same as Excalidraw's, using the room key from your share link. Excalidraw skips message types it doesn't know. Peers with the extension decrypt the roll, validate it, and throw the same result.

The roller's browser decides the result with `crypto.getRandomValues`. Each browser then runs its own physics simulation, steered so every die lands on that face.

**Privacy.** Excalidice has no server, no analytics and no extra permissions: it runs only on excalidraw.com, and the only network traffic it creates is roll messages inside your own encrypted collaboration room. It stores your dice color in the page's local storage.

**Unofficial.** Excalidice isn't affiliated with Excalidraw. It reaches Excalidraw's internals by walking React's component tree, so an Excalidraw update can break shared rolls. If that happens, the tray says "not shared" and keeps rolling locally until Excalidice is updated.

## Develop

You need [Bun](https://bun.sh).

```sh
bun install
bun run build     # bundle into dist/, then Load unpacked from there
bun run check     # typecheck
bun test
bun run package   # build and zip into excalidice-<version>.zip
```

After rebuilding, press the reload icon on the extension's card and reload the Excalidraw tab.

| Path | What it is |
| --- | --- |
| `src/content.ts` | The toolbar button, the tray, and the overlay the dice are thrown on. Runs in the extension's isolated world. |
| `src/page.ts` | Runs in Excalidraw's own page world to reach its collaboration socket and viewport; talks to the tray through window events (`src/bridge.ts`). |
| `src/dice/` | Dice notation, exploding rolls, and validation of rolls that arrive from peers. |
| `src/table/` | The three.js stage and hand-drawn explosion effects. `engine/` holds the physics: a cannon-es pre-roll that bakes in a rotation so each die lands on its decided face. |
| `art/` | Icon sources. |

To release, bump `version` in `manifest.json` and `package.json`, then push a matching tag (`git tag v0.2.0 && git push --tags`). The release workflow builds the extension and attaches the zip to a GitHub release.

## Credits

Built with [three.js](https://threejs.org) and [cannon-es](https://github.com/pmndrs/cannon-es). The exploding-dice rule comes from *Kids on Bikes* by Jonathan Gilmour and Doug Levandowski. Excalidraw is by the [Excalidraw team](https://github.com/excalidraw/excalidraw).

## License

[MIT](LICENSE)
