/**
 * Optional sample overrides for the procedural cues.
 *
 * Every sound in the game is synthesised by default (see AudioManager), so this
 * is purely additive: drop audio files into `public/assets/audio/`, list them in
 * `public/assets/audio/manifest.json`, and each one replaces its synth cue.
 * Anything not listed keeps the procedural version, so a partial set is fine —
 * you can replace just the gunfire and leave the rest alone.
 *
 * The manifest is a plain array of filenames:
 *
 *     ["rifle_fire.ogg", "pistol_fire.ogg", "footstep_run.wav"]
 *
 * A file maps to a cue by its base name, per SOUND_FILES below. The manifest
 * exists so that a game with no custom audio costs exactly one 404 rather than
 * one per cue per extension.
 */

/**
 * cue name -> base filename in `public/assets/audio/`.
 *
 * The per-weapon cues are what make one gun sound different from another; see
 * `sounds` in each weapon descriptor in `src/weapons/Loadout.js`.
 */
export const SOUND_FILES = {
  /* ---------------------------------------------------------- the rifle -- */
  rifleFire: 'rifle_fire',
  rifleReloadStart: 'rifle_reload_start',
  rifleMagOut: 'rifle_mag_out',
  rifleMagIn: 'rifle_mag_in',
  rifleBolt: 'rifle_bolt',

  /* -------------------------------------------------------- the sidearm -- */
  pistolFire: 'pistol_fire',
  pistolReloadStart: 'pistol_reload_start',
  pistolMagOut: 'pistol_mag_out',
  pistolMagIn: 'pistol_mag_in',
  pistolSlide: 'pistol_slide',

  /* ---------------------------------------------------------- the knife -- */
  knifeSwing: 'knife_swing',
  knifeHit: 'knife_hit',

  /* ------------------------------------------------------------ shared -- */
  dryFire: 'dry_fire',
  enemyFire: 'enemy_fire',
  impact: 'impact',
  ricochet: 'ricochet',
  whizz: 'whizz',
  weaponSwap: 'weapon_swap',

  /* --------------------------------------------------------- the player -- */
  footstep: 'footstep',
  footstepRun: 'footstep_run',
  jump: 'jump',
  land: 'land',
  playerHurt: 'player_hurt',
  playerDeath: 'player_death',

  /* --------------------------------------------------------- the squad -- */
  enemyDeath: 'enemy_death',
  bodyFall: 'body_fall',
  spawn: 'spawn',

  /* ------------------------------------------------------------- the UI -- */
  hitmarker: 'hitmarker',
  hitmarkerHead: 'hitmarker_head',
  uiClick: 'ui_click',
  uiHover: 'ui_hover',
  uiBack: 'ui_back',
  matchStart: 'match_start',
  victory: 'victory',
  defeat: 'defeat',
  countdown: 'countdown'
};

/** base filename -> cue name, for resolving what the manifest lists. */
const BY_BASENAME = new Map(
  Object.entries(SOUND_FILES).map(([cue, base]) => [base, cue])
);

/**
 * Read the manifest and point the audio manager at whatever it lists. Silent
 * when there is no manifest — that is the normal state for a build running
 * entirely on its synthesised audio.
 *
 * @param {import('./AudioManager.js').AudioManager} audio
 * @param {string} [dir]
 * @returns {Promise<number>} how many cues were overridden
 */
export async function registerSoundFiles(audio, dir = 'assets/audio') {
  let names;
  try {
    const res = await fetch(`${dir}/manifest.json`);
    if (!res.ok) return 0;
    names = await res.json();
  } catch {
    return 0; // no manifest: everything stays procedural
  }
  if (!Array.isArray(names)) {
    console.warn('[audio] manifest.json should be an array of filenames');
    return 0;
  }

  let count = 0;
  for (const file of names) {
    // "rifle_fire_2.ogg" -> the rifleFire cue: a trailing _N marks a variant,
    // and several variants against one cue become a pool played at random
    const base = String(file).replace(/\.[^.]+$/, '').replace(/_\d+$/, '');
    const cue = BY_BASENAME.get(base);
    if (!cue) {
      console.warn(`[audio] "${file}" does not match any cue; see SOUND_FILES`);
      continue;
    }
    audio.registerFile(cue, `${dir}/${file}`);
    count++;
  }
  return count;
}
