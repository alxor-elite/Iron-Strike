# Assets

**The only binary assets IRON STRIKE ships are the weapon and arm models in
`models/` (credited below).** Everything else you see and hear is generated at
runtime:

- **Geometry** — every prop, building and character is built from
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

Every sound is synthesised at runtime, and any cue can be replaced by a file.
Drop audio into `public/assets/audio/` and list what you added in
`public/assets/audio/manifest.json`:

```json
["rifle_fire.ogg", "pistol_fire.ogg", "footstep_run.wav"]
```

A file binds to a cue by its base name — the full list of names lives in
`SOUND_FILES` in `src/audio/SoundFiles.js`. Anything you do not list keeps its
procedural cue, so a partial set is fine. `.ogg`, `.wav` and `.mp3` all work
(whatever the browser can decode). The manifest is what keeps a build with no
custom audio from firing off a request per cue.

**Weapons have their own cues**, which is what lets them sound different:

| Rifle | Sidearm | Knife |
| --- | --- | --- |
| `rifle_fire` | `pistol_fire` | `knife_swing` |
| `rifle_reload_start` | `pistol_reload_start` | `knife_hit` |
| `rifle_mag_out` | `pistol_mag_out` | |
| `rifle_mag_in` | `pistol_mag_in` | |
| `rifle_bolt` | `pistol_slide` | |

Movement splits walking from sprinting: `footstep` and `footstep_run`, plus
`jump` and `land`. The rest — `impact`, `ricochet`, `whizz`, `weapon_swap`,
`enemy_fire`, `hitmarker`, `player_hurt`, UI and match cues — follow the same
naming.

Which weapon plays which cue is set per weapon in `src/weapons/Loadout.js`
(`sounds:`), so pointing a new gun at its own sounds is a two-line change.

### 2. GLTF / GLB models

Optional. Put `.glb` files here and load them with `GLTFLoader`
(`three/examples/jsm/loaders/GLTFLoader.js`) during `Game.build()`. If you swap
in a model for the enemies, keep the per-part `userData.hitZone` tags
(`'head' | 'body' | 'limb'`) so the damage model keeps working, and keep the
collision capsule dimensions in `src/enemies/Enemy.js`.

Only use assets you have the rights to (CC0 / CC-BY with attribution / your
own). Record their licences in this file.

## Licences of bundled assets

Every CC BY asset below is credited in the main-menu footer (`index.html`) and
in the root `README.md`. Attribution is required wherever the game is
distributed, so keep both.

### `models/ak47.glb` — the rifle

- **Credit:** "Assault Rifle" by Zsky via Poly Pizza (https://poly.pizza/)
- **Licence:** CC BY

Three material groups (black metal, brown furniture, grey sights), already
modelled muzzle-down -Z with +Y up, so it needs no reorientation.

### `models/pistol.glb` — the sidearm

- **Credit:** "Pistol" by Zsky via Poly Pizza (https://poly.pizza/)
- **Licence:** CC BY

Same pipeline and conventions as the rifle. Renamed from
`Pistol by Zsky - 3To2e7sKmO.glb` so the URL needs no escaping.

### `models/knife.glb` — the melee weapon

- **Credit:** "Knife" by Quaternius (https://quaternius.com/)
- **Licence:** Public domain (CC0) — attribution not required, given anyway

### `audio/` — the installed sample set

Trimmed from longer source recordings, mixed to mono, normalised and tapered,
then listed in `audio/manifest.json`. All derivatives, which CC BY permits.

- **Gunfire** (`rifle_fire_*`, `pistol_fire_*`, `enemy_fire_*`) — Vincent
  Sevedge, from https://opengameart.org/content/gunshot-sounds — CC BY 3.0.
  The OGA page is tagged CC0 and credits "Tabasco", but the archive's own
  `creativecommons.txt` says CC BY 3.0 / Vincent Sevedge; the stricter of the
  two is what is honoured here.
  Sources: `cz.wav` (CZ-52) → sidearm, `sks.wav` (SKS) → rifle, `mosin.wav`
  (Mosin Nagant) → enemy fire, so the three read as different weapons.
- **Footsteps** (`footstep_*`, `footstep_run_*`) — congusbongus,
  https://opengameart.org/content/footsteps-on-different-surfaces, derived from
  `footstep-concrete.wav` by swuing — CC BY 3.0. The "boots on concrete" set.
- **Reloads** (`rifle_mag_*`, `pistol_mag_*`, `rifle_bolt`) — SpringySpringo,
  https://opengameart.org/content/gun-reload-sounds — CC0.

Everything not listed above is still synthesised: the knife, the pistol slide,
weapon swap, dry fire, impacts, jump/land, hit markers, UI and match cues.

### `models/arms.glb` — first-person arms

- **Title:** "Low Poly Arms"
- **Author:** yalcinn1284 — https://sketchfab.com/yalcinn1284
- **Source:** https://sketchfab.com/3d-models/low-poly-arms-e8b00a9ec098405783af2cc94a37be67
- **Licence:** CC BY 4.0 — http://creativecommons.org/licenses/by/4.0/

A mirrored pair of arms welded into one mesh per material, with no skeleton.
`src/weapons/Arms.js` splits it down the plane of symmetry into two independent
arms and fits each to the weapon; see `ARMS_MODEL` in `src/weapons/Loadout.js`
for the placement numbers.

### `models/guns_low_poly.glb` — currently unused

- **Title:** "Guns Low poly"
- **Author:** Satendra Saraswat — https://sketchfab.com/satendra5286
- **Source:** https://sketchfab.com/3d-models/guns-low-poly-e61b238f8c364c5bbdfe4bab0aaa08a3
- **Licence:** CC BY 4.0 — http://creativecommons.org/licenses/by/4.0/

No longer loaded by the game — `ak47.glb` replaced it — but kept because it is
a useful source of further weapons. The pack holds 14 meshes: `MG1`-`MG5`
(rifles), `GL1` (grenade launcher), `MSR` (pistol), `SNIPER1`, `RPG` and five
projectiles (`BE1`-`BE5`). Its guns are modelled running along -Y with +X
pointing down, so a `basis` is needed to bring one into the engine's convention.

Delete the file if you do not want it, and drop its credit from the menu footer
and the root README when you do — it only needs attribution while it ships.
