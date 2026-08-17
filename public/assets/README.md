# Assets

**IRON STRIKE ships with zero binary assets.** Everything you see and hear is
generated at runtime:

- **Geometry** — every prop, building, character and the weapon are built from
  Three.js primitives (`BoxGeometry`, `CylinderGeometry`, `SphereGeometry`,
  `ConeGeometry`, `PlaneGeometry`, `IcosahedronGeometry`) plus custom
  `BufferGeometry` (see `src/world/Geo.js` → `trapezoidPrism`, `rubbleGeom`) and
  merged with `BufferGeometryUtils.mergeGeometries`.
- **Textures** — painted procedurally into `<canvas>` elements at load time
  (`src/world/Textures.js`): concrete, floor slab, corrugated steel, brushed
  metal, rust, wood planks, chain-link, grating, hazard stripes, glow sprites,
  smoke puffs and bullet-hole decals.
- **Audio** — synthesised with the Web Audio API (`src/audio/AudioManager.js`):
  filtered noise bursts, oscillator thumps and short arpeggios.

Nothing here is derived from any commercial game.

---

## Adding your own (freely licensed) assets

This directory is the place for them. Two supported paths:

### 1. Audio samples

The audio manager looks up cues by name and prefers a decoded sample over its
built-in synth. Drop files here and register them (e.g. in `src/main.js` after
constructing the game, or at the end of `Game`'s constructor):

```js
game.audio.registerFile('rifleFire', 'assets/audio/rifle_fire.ogg');
game.audio.registerFile('footstep',  'assets/audio/footstep_concrete.ogg');
```

If a file is missing or fails to decode, the procedural cue is used instead — so
a partial set is fine. Cue names available (see `CUE_NAMES` in
`src/audio/AudioManager.js`):

```
rifleFire  enemyFire  dryFire  impact  ricochet
reloadStart  magOut  magIn  boltRelease
footstep  jump  land
hitmarker  hitmarkerHead  playerHurt  enemyDeath  bodyFall  playerDeath
spawn  whizz
uiClick  uiHover  uiBack  matchStart  victory  defeat  countdown
```

### 2. GLTF / GLB models

Optional. Put `.glb` files here and load them with `GLTFLoader`
(`three/examples/jsm/loaders/GLTFLoader.js`) during `Game.build()`. If you swap
in a model for the enemies, keep the per-part `userData.hitZone` tags
(`'head' | 'body' | 'limb'`) so the damage model keeps working, and keep the
collision capsule dimensions in `src/enemies/Enemy.js`.

Only use assets you have the rights to (CC0 / CC-BY with attribution / your
own). Record their licences in this file.

## Licences of bundled assets

None — there are no bundled assets.
