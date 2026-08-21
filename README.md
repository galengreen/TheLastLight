# Last Light

A small pixel-art top-down survival shooter built with Phaser 3.

## Run it

```sh
npm install
npm run dev
```

Move with **WASD** or the **arrow keys**. Aim with the cursor, hold the left mouse button to fire, and press **E** to interact with supply drops. After being overrun, click or press **R** to restart.

Pause with **P** or **Escape**.

## Development

```sh
npm run typecheck
npm run build
```

Collision visualization is disabled by default. During `npm run dev` only, press **F2** to toggle it. The debug renderer and key binding are excluded from production builds.

## Structure

- `src/scenes/` coordinates Phaser scene lifecycle and gameplay.
- `src/systems/` owns focused stateful concerns such as audio, lighting, and wave direction.
- `src/config/` contains shared tuning constants and the Phaser configuration.
- `src/assets/` contains runtime-ready assets and their typed load manifest.
- `art-source/` contains editable pixel-art pipeline sources that are not shipped at runtime.
