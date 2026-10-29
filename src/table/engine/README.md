# Dice engine

Adapted from the dice engine in lancer-vtt, the author's Lancer tabletop project. The physics
pre-roll records each die's tumble to rest, then bakes in one fixed rotation so it lands on
the value the roll already decided.

Local changes, marked `dice:` in comments:

- `diceBody.ts`: `spawnFrom` launches a die out of a point on the table (an exploding die's burst).
- Lighter, longer tumble: gravity -64 → -42, die damping 0.7/0.4 → 0.4/0.2, floor restitution 0.1 → 0.3 (friction 0.6 → 0.45), wall restitution 0.2 → 0.45, spin 16 → 22, sim budget 200 → 300 frames. The stage plays back at 1.5× instead of 2×.
- `numeralTexture.ts`: d10 numerals at 0.3 of the cell instead of the d12's 0.48.
- `bakedCorrection.ts`: `ThrowSpec.from` uses it; `RecordOptions.obstacles` adds settled dice as static bodies.

The stage that renders all this (`../stage.ts`) is written for Excalidice.
