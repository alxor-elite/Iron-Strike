# IRON STRIKE

A single-player, browser-native **3D first-person shooter** — Team Deathmatch
against an AI squad on one compact industrial map. Built with **Three.js + Vite**
and no game engine. Every texture and sound, the map, the characters and all
effects are generated at runtime; the only binary assets are the imported
weapon and arm models (see [Assets and licences](#assets-and-licences)).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle in dist/
npm run preview  # serve the production build
```

Click **PLAY**, then click once more to lock the mouse.

---

## The mode

**Team Deathmatch — RAVEN (you) vs VULTURE (6 AI).**

- Every AI you drop scores for RAVEN; every time you go down scores for VULTURE.
- **First to 30 kills wins**; otherwise the higher score at **5:00** wins.
- Both sides respawn 3 seconds after dying; enemy spawns are kept ≥26 m from you.
- Results screen shows kills, deaths, K/D, headshots, accuracy and damage, with
  **PLAY AGAIN** (instant — the map is not rebuilt) and **MAIN MENU**.

## Controls

| Input | Action | Input | Action |
| --- | --- | --- | --- |
| `W A S D` | Move | `LMB` | Fire |
| `SHIFT` | Sprint | `RMB` | Aim down sights |
| `SPACE` | Jump | `R` | Reload |
| `CTRL` / `C` | Crouch | `TAB` | Scoreboard |
| `ESC` | Pause / release mouse | `F` | Flashlight |
| `1` `2` `3` | Rifle / sidearm / knife | `Q`, wheel | Cycle weapons |

## Weapons

Three slots, switched with `1` `2` `3`, `Q` or the scroll wheel. Swapping takes
0.42 s, during which the weapon rises into view and cannot fire.

| | Damage (head/body/limb) | Magazine | Notes |
| --- | --- | --- | --- |
| **AK-47** | 100 / 30 / 20 | 30 (+120) | ~600 RPM, 145 m |
| **Sidearm** | 100 / 26 / 17 | 12 (+60) | ~420 RPM, 90 m, tighter ADS |
| **Combat knife** | 100 / 55 / 40 | — | 2.4 m reach in a 99° arc |

Every firearm has recoil springs, spread bloom, ADS zoom with an aligned
red-dot, muzzle flash + world light, tracers, ejected brass, impact decals and
hit markers (with a `HEADSHOT` banner). The knife swings on a timer: the cut
lands 0.13 s in and sweeps an arc, so you need to be close but not precise. It
is confirmed with a line-of-sight check, so it cannot reach through walls.

Eliminations resupply 25 rounds to both firearms — 150 rounds would never cover
a 30-kill match.

The rifle and the first-person arms are imported meshes (see
[Assets and licences](#assets-and-licences)), rigged at load time rather than in
a modelling tool:

- the gun is re-oriented into viewmodel space, normalised to length and anchored
  so its sight line matches the ADS pose, then its magazine is carved out of the
  welded mesh into its own part so the reload still drops one;
- the arms come as one mirrored pair with no skeleton, so they are split down
  their plane of symmetry into two independent arms and each is rotated to run
  from its hand back off the bottom of the screen.

The original procedural KV-9 "WIDOWMAKER" and its gloved hands are still in the
build and are used automatically if the models are missing.

## FOUNDRY-7 (the map)

Generated procedurally in `src/world/`: a central warehouse with catwalks, a
central bridge and skylight shafts; two annex buildings with roof-top firing
positions reached by external stairs; a covered north corridor; a loading dock;
blast-wall lanes; a water tower and silos; and ~250 props (containers, crates,
barrels, sandbags, jersey barriers, chain-link, street lights) placed with
automatic validation so nothing ever intersects a wall or blocks a doorway.

Team A base sits west, team B east, with several independent routes between them.

## Enemy AI

Per-enemy FSM: `IDLE → PATROL → SEARCH → CHASE → ATTACK ⇄ TAKE_COVER`, plus
`DEAD`. Enemies

- detect you by distance **+ field of view + a line-of-sight test**, with
  awareness that builds over time (sprinting is noisier, crouching is quieter,
  gunfire nearby raises alertness);
- remember your last known position for ~6.5 s and sweep it;
- navigate a 120-node waypoint graph with A* and string-pulled paths, including
  stairs, catwalks and roofs, with stuck detection and recovery;
- fire in bursts with an individual reaction delay, aim-convergence time,
  accuracy, distance falloff and cooldown — so **plenty of shots miss**, cover
  actually protects you, and they stop shooting when you break line of sight;
- break to cover when hurt, when reloading, or after too long in the open.

## Architecture

```
src/
  main.js                  entry point, WebGL guard, fatal-error screen
  game/    Game.js         renderer, two render passes, systems, frame loop, match flow
           GameState.js    screen state machine
           MatchManager.js TDM rules, score, timer, kill log
           Settings.js     localStorage-backed settings
  player/  Player.js       movement, gravity, crouch/sprint/jump, health, damage
           PlayerCamera.js mouse look, recoil springs, shake, ADS FOV blending
           PlayerController.js keyboard/mouse + Pointer Lock
  weapons/ Weapon.js       fire timing, spread, reload state machine, hitscan
           AssaultRifle.js the procedural KV-9 viewmodel and stats
           ModelRifle.js   the same rig built from an imported mesh
           GunGeometry.js  orienting, anchoring and splitting imported meshes
           Arms.js         first-person arms split from a mirrored pair
           Hands.js        the procedural gloved hands
           Loadout.js      which models are used and how they are fitted
  enemies/ Enemy.js        low-poly humanoid, procedural animation, hit zones
           EnemyAI.js      the FSM, perception, navigation, shooting
           EnemyManager.js squad, pooling, respawns, gunshot broadcast
  world/   Map.js          scene graph, colliders, spawns, quality switching
           Environment.js  materials, lighting, sky/fog, structures
           Props.js        instanced prop placement
           NavGraph.js     waypoint graph, A*, cover points
           Geo.js          geometry helpers, merging, custom BufferGeometry
           Textures.js     procedural canvas textures
  effects/ ParticleSystem.js pooled GPU point clouds, tracers, brass, decals
           MuzzleFlash.js  view-space flash
           HitEffect.js    impact/flesh/dust/muzzle-light facade
  audio/   AudioManager.js Web Audio synthesis, positional playback, file overrides
  ui/      HUD.js MainMenu.js PauseMenu.js Screens.js Scoreboard.js
  utils/   Collision.js    AABB grid, actor resolution, ray/box queries
           RaycastUtils.js shared raycaster, ray/capsule maths
           MathUtils.js
```

### Notable implementation choices

- **Two render passes.** The world is drawn with the main camera, then the depth
  buffer is cleared and the viewmodel is drawn with its own camera — the weapon
  can never clip into geometry.
- **Sight lines use the collider grid, not mesh raycasting.** An `InstancedMesh`
  raycast transforms every instance, which made AI perception and the navigation
  bake dominate the frame. A slab test over the AABB broadphase replaced it and
  cut the nav bake from seconds to ~30 ms. Player bullets still use mesh
  raycasting, because they need exact points, normals and per-part hit zones.
- **Fences and railings block movement but not sight or bullets** (`opaque:
  false` colliders).
- **Pooling everywhere**: particles, tracers, brass, decals and enemies are
  recycled; no per-frame allocation in the hot path.
- **Shadow frustum follows the player**, snapped to a grid — better texel
  density and most of the map is culled out of the shadow pass.
- **Shaders are precompiled** behind the loading bar so the first seconds of a
  match don't hitch.

### Graphics quality

`LOW` disables shadows, dynamic lamp lights, decals and brass, and drops the
pixel ratio to 0.85. `MEDIUM` uses 1024² shadows; `HIGH` uses 2048² soft shadows
and five interior point lights. Gameplay logic costs ~0.3 ms per frame, so frame
rate is bound by the GPU/quality setting rather than the simulation.

## Audio

Every cue (gunfire, reload steps, footsteps, hit markers, deaths, UI, match
start/victory/defeat) is synthesised with the Web Audio API — filtered noise
bursts and oscillator envelopes — mixed through a limiter and positioned with
distance attenuation and stereo panning. Royalty-free samples can be dropped in
without code changes; see `public/assets/README.md`.

## Requirements

A desktop browser with WebGL 2 and the Pointer Lock API — recent Chrome, Edge,
Firefox or Safari. Node 18+ to build. Keyboard and mouse required (there are no
touch controls). If WebGL is unavailable the game shows an explanatory screen
instead of a black canvas.

## Deploying

The Vite build uses a relative `base`, so `dist/` can be served from any static
host or a project subpath (GitHub Pages included):

```bash
npm run build      # -> dist/
npm run preview    # verify the production bundle locally
```

## Assets and licences

| Asset | Used for | Credit | Licence |
| --- | --- | --- | --- |
| `ak47.glb` | the rifle | **Assault Rifle** by [Zsky](https://poly.pizza/u/Zsky) via [Poly Pizza](https://poly.pizza/) | CC BY |
| `pistol.glb` | the sidearm | **Pistol** by [Zsky](https://poly.pizza/u/Zsky) via [Poly Pizza](https://poly.pizza/) | CC BY |
| `knife.glb` | the melee weapon | **Knife** by [Quaternius](https://quaternius.com/) | Public domain (CC0) |
| `arms.glb` | first-person arms | **Low Poly Arms** by [yalcinn1284](https://sketchfab.com/yalcinn1284) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |
| `guns_low_poly.glb` | unused (kept as a source of further weapons) | **Guns Low poly** by [Satendra Saraswat](https://sketchfab.com/satendra5286) | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) |

All model files live in `public/assets/models/`.

The CC BY assets require attribution wherever the work is distributed — the
credit line in the main-menu footer and this table are that attribution. Keep
both if you fork or deploy this. The knife is public domain and needs no
attribution; it is credited anyway.

Poly Pizza states "CC-BY" without a version on its download dialog — check the
model's own page for the exact version if that distinction matters to you.

## Originality

Apart from the weapon model credited above, everything here is original: the
name, the map, the characters, the UI, the audio and the code. No assets, audio,
branding, maps or UI from any commercial game are used or reproduced.

## License

[MIT](LICENSE) © alxor-elite
"# Iron-Strike" 
