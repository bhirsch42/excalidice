# Chrome Web Store listing

Everything the developer dashboard asks for, in its order. Upload the zip from `bun run package`.

## Store listing

**Description**

> Roll 3D dice right on your Excalidraw board.
>
> Excalidice adds a dice tool to excalidraw.com's toolbar. Pick a d4, d6, d8, d10, d12 or d20, or type notation like 2d6+1, and the dice tumble across your whole board, then sweep away a few seconds after they land.
>
> • Exploding dice, as in Kids on Bikes: roll a die's maximum and a new die leaps out of it and rolls again, adding on. Turn it off with one checkbox.
> • Multiplayer with no server: start a live collaboration in Excalidraw and everyone with Excalidice sees the same rolls, in step. Rolls travel over Excalidraw's own end-to-end encrypted channel.
> • At home on the board: explosions are drawn in Excalidraw's plain hand-drawn style, it follows light and dark mode, and the dice pan and zoom with the canvas.
> • Rolls carry your Excalidraw collaboration name and a dice color you pick.
>
> Excalidice collects no data, has no server and no analytics, and runs only on excalidraw.com. It's open source (MIT): https://github.com/bhirsch42/excalidice
>
> Excalidice is an independent project, not affiliated with Excalidraw.

**Category:** Lifestyle › Games (or Entertainment if Games isn't offered)

**Language:** English

**Graphic assets**

- Store icon (128×128: 96px art, 16px transparent padding, soft white edge for dark backgrounds): `store/store-icon-128.png` (same as `icons/icon-128.png`)
- Screenshots (1280×800): `store/screenshot-roll.png`, `store/screenshot-tray.png`
- Small promo tile (440×280): `store/promo-small.png`
- Marquee promo tile (1400×560, 24-bit, no alpha): `store/promo-marquee.png`

**Additional fields**

- Homepage URL: https://github.com/bhirsch42/excalidice
- Support URL: https://github.com/bhirsch42/excalidice/issues

## Privacy

**Single purpose**

> Adds a dice-rolling tool to excalidraw.com: 3D dice thrown across the board, shared with the other people in an Excalidraw live collaboration.

**Permission justification**

- Host permission (content scripts on `https://excalidraw.com/*`): "Excalidice only works on excalidraw.com. It adds its dice button to Excalidraw's toolbar, draws the dice over the board, and sends rolls to collaborators through Excalidraw's existing encrypted collaboration connection."

**Remote code:** No, I am not using remote code. (Everything is bundled in the package.)

**Data usage:** check nothing; Excalidice collects none of the listed data types. Then tick all three certifications (not sold to third parties, not used for unrelated purposes, not used for creditworthiness).

**Privacy policy URL:** https://github.com/bhirsch42/excalidice#how-it-works

## Distribution

- Payments: free
- Visibility: **Unlisted**
- Regions: all regions
