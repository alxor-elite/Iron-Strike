/**
 * Game — the orchestrator.
 *
 * Owns the renderer, the two render passes (world + viewmodel), every gameplay
 * system, the screen-state machine and the frame loop, and implements the match
 * flow: MENU → LOADING → PLAYING ⇄ PAUSED, with death/respawn and results.
 */

import * as THREE from 'three';

import { GameState, StateMachine } from './GameState.js';
import { MatchManager } from './MatchManager.js';
import { Settings } from './Settings.js';

import { GameMap } from '../world/Map.js';
import { Player } from '../player/Player.js';
import { PlayerCamera } from '../player/PlayerCamera.js';
import { PlayerController } from '../player/PlayerController.js';
import { AssaultRifle } from '../weapons/AssaultRifle.js';
import { EnemyManager } from '../enemies/EnemyManager.js';
import { HitEffects } from '../effects/HitEffect.js';
import { AudioManager } from '../audio/AudioManager.js';
import { setRaycastCamera } from '../utils/RaycastUtils.js';

import { HUD } from '../ui/HUD.js';
import { MainMenu, SettingsPanel, ControlsPanel } from '../ui/MainMenu.js';
import { PauseMenu } from '../ui/PauseMenu.js';
import { LoadingScreen, ResumePrompt, DeathScreen, ResultsScreen } from '../ui/Screens.js';

const RESPAWN_DELAY = 3.0;
const MAX_DT = 1 / 20;

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.time = 0;
    this.lastPlayerShotTime = -100;
    this.frameCount = 0;
    this.fps = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._respawnTimer = 0;
    this._killerName = null;
    this.built = false;

    this.settings = new Settings();
    this.state = new StateMachine(GameState.BOOT);

    /* ------------------------------------------------------------ renderer */
    const quality = this.settings.get('quality');
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x05070a, 1);

    /* --------------------------------------------------------------- scene */
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      this.settings.get('fov'), window.innerWidth / window.innerHeight, 0.08, 320
    );
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    setRaycastCamera(this.camera);

    // separate pass for the weapon so it never clips into geometry
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(
      58, window.innerWidth / window.innerHeight, 0.005, 6
    );
    this.viewScene.add(new THREE.AmbientLight(0x8fa2b4, 1.5));
    const vKey = new THREE.DirectionalLight(0xfff1dc, 2.2);
    vKey.position.set(0.6, 1, 0.55);
    this.viewScene.add(vKey);
    const vFill = new THREE.DirectionalLight(0x6f8ea8, 1.1);
    vFill.position.set(-0.7, 0.2, -0.6);
    this.viewScene.add(vFill);

    /* ------------------------------------------------------------- systems */
    this.audio = new AudioManager(this.settings);
    this.playerCamera = new PlayerCamera(this.camera, this.settings);
    this.player = new Player(this);
    this.controller = new PlayerController(canvas, this.playerCamera, this.settings);
    this.hud = new HUD(this);
    this.match = new MatchManager(this, { scoreLimit: 30, duration: 300 });

    this.map = null;
    this.effects = null;
    this.enemyManager = null;
    this.weapon = null;
    this.raycastTargets = [];
    this.aimDir = new THREE.Vector3(0, 0, -1);

    /* ------------------------------------------------------------------ UI */
    this.ui = {
      menu: new MainMenu(this),
      settings: new SettingsPanel(this),
      controls: new ControlsPanel(this),
      pause: new PauseMenu(this),
      loading: new LoadingScreen(),
      resume: new ResumePrompt(this),
      death: new DeathScreen(),
      results: new ResultsScreen(this)
    };

    /* -------------------------------------------------------------- events */
    this.controller.onPause = () => {
      if (this.state.is(GameState.PLAYING, GameState.DEAD)) this.pause();
    };
    this.controller.onLockChange = (locked) => {
      if (locked) this.ui.resume.hide();
    };
    this.controller.onFlashlight = () => this.toggleFlashlight();

    this.settings.onChange((key) => this.applySettings(key));

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state.is(GameState.PLAYING, GameState.DEAD)) this.pause();
    });

    this.flashlight = new THREE.SpotLight(0xfff0d8, 0, 26, 0.42, 0.4, 1.4);
    this.flashlight.visible = false;
    this.camera.add(this.flashlight);
    this.flashlight.position.set(0.1, -0.1, 0);
    this.flashlight.target.position.set(0, 0, -1);
    this.camera.add(this.flashlight.target);
    this.flashlightOn = false;

    this.state.set(GameState.MENU);
    this.ui.menu.show();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  /* ============================================================== settings */

  applySettings(key) {
    const s = this.settings.values;
    if (key === 'volume' || key === '*') this.audio.setVolume(s.volume);
    if (key === 'fov' || key === '*') {
      this.playerCamera.onFovSettingChanged(s.fov);
    }
    if (key === 'quality' || key === '*') this.applyQuality(s.quality);
    if (key === '*') this.ui.settings.syncFromSettings();
  }

  applyQuality(quality) {
    const dpr = window.devicePixelRatio || 1;
    const cap = quality === 'high' ? 1.75 : quality === 'medium' ? 1.25 : 0.85;
    this.renderer.setPixelRatio(Math.min(dpr, cap));
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.renderer.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (this.map) this.map.setQuality(quality);
    if (this.effects) this.effects.setQuality(quality);
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h;
    this.viewCamera.updateProjectionMatrix();
  }

  toggleFlashlight() {
    this.flashlightOn = !this.flashlightOn;
    this.flashlight.visible = this.flashlightOn;
    this.flashlight.intensity = this.flashlightOn ? 22 : 0;
    this.audio.play('uiClick', { volume: 0.4 });
  }

  /* ================================================================= build */

  async build() {
    const loading = this.ui.loading;
    const quality = this.settings.get('quality');
    // yield to the browser between build steps so the loading bar animates;
    // falls back to a timer because a hidden tab never fires rAF
    const frame = () => new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      requestAnimationFrame(finish);
      setTimeout(finish, 60);
    });

    loading.setProgress(0.04, 'Initialising renderer…');
    this.applyQuality(quality);
    await frame();

    loading.setProgress(0.12, 'Generating FOUNDRY-7…');
    await frame();

    this.map = new GameMap(this.scene, quality);
    const steps = this.map.getBuildSteps();
    for (let i = 0; i < steps.length; i++) {
      loading.setProgress(0.12 + (i / steps.length) * 0.62, steps[i].label);
      await frame();
      steps[i].run();
    }
    await frame();

    loading.setProgress(0.78, 'Spawning effects systems…');
    this.effects = new HitEffects(this.scene, quality);
    this.effects.setFloorSampler((x, z) =>
      this.map.collision.groundHeightAt(x, z, this.player.position.y + 1.4, 0.06));
    await frame();

    loading.setProgress(0.86, 'Briefing hostile squad…');
    this.enemyManager = new EnemyManager(this, 6);
    this.raycastTargets = [this.map.solids, this.enemyManager.group];
    await frame();

    loading.setProgress(0.9, 'Issuing weapon…');
    this.weapon = new AssaultRifle(this);
    this.hud.setWeaponName(this.weapon.name);
    await frame();

    // Compile every shader up front. On weak drivers this is seconds of work;
    // doing it here keeps it behind the loading bar instead of hitching the
    // first seconds of the match.
    loading.setProgress(0.95, 'Compiling shaders…');
    try {
      // compile() does the work synchronously; compileAsync() additionally
      // waits for the driver to report readiness, which can stall for a long
      // time (e.g. in a background tab), so it is capped by a timeout.
      this.renderer.compile(this.scene, this.camera);
      this.renderer.compile(this.viewScene, this.viewCamera);
      if (this.renderer.compileAsync) {
        const cap = new Promise((r) => setTimeout(r, 4000));
        await Promise.race([this.renderer.compileAsync(this.scene, this.camera), cap]);
      }
    } catch (err) {
      console.warn('[game] shader precompile skipped:', err);
    }
    await frame();

    loading.setProgress(1, 'Ready.');
    this.built = true;
    await frame();
  }

  /* ============================================================ match flow */

  async startMatch() {
    if (this.state.is(GameState.LOADING)) return;
    this.state.set(GameState.LOADING);
    this.ui.loading.show();
    this.audio.init();

    try {
      if (!this.built) await this.build();
    } catch (err) {
      console.error('[game] build failed', err);
      throw err;
    }

    this._beginMatch();
    this.ui.loading.hide();
  }

  _beginMatch() {
    // reset stats and systems
    const p = this.player;
    p.stats = { shotsFired: 0, hits: 0, headshots: 0, damageDealt: 0, deaths: 0, kills: 0 };
    this.effects.clear();
    this.hud.reset();
    this.weapon.reset();

    const spawn = this.map.getSpawn('A', null, 0, true);
    const yaw = Math.atan2(spawn.x, spawn.z); // face the middle of the map
    p.spawn(spawn, yaw);

    this.enemyManager.reset();
    this.match.start();

    this.hud.show();
    this.hud.setWeaponName(this.weapon.name);
    this.state.set(GameState.PLAYING);
    this.controller.setEnabled(true);
    this.requestLock();
  }

  restartMatch() {
    if (!this.built) { this.startMatch(); return; }
    this.ui.results.hide();
    this.ui.death.hide();
    this.ui.pause.hide();
    this._beginMatch();
  }

  returnToMenu() {
    this.match.stop();
    this.controller.setEnabled(false);
    this.controller.releaseLock();
    this.ui.pause.hide();
    this.ui.results.hide();
    this.ui.death.hide();
    this.ui.resume.hide();
    this.hud.hide();
    if (this.effects) this.effects.clear();
    if (this.enemyManager) this.enemyManager.enemies.forEach((e) => e.deactivate());
    this.state.set(GameState.MENU);
    this.ui.menu.show();
  }

  pause() {
    if (!this.state.is(GameState.PLAYING, GameState.DEAD)) return;
    this._resumeState = this.state.current;
    this.state.set(GameState.PAUSED);
    this.controller.setEnabled(false);
    this.controller.releaseLock();
    this.ui.resume.hide();
    this.ui.pause.show();
  }

  resume() {
    if (!this.state.is(GameState.PAUSED)) return;
    this.state.set(this._resumeState === GameState.DEAD ? GameState.DEAD : GameState.PLAYING);
    this.controller.setEnabled(true);
    this.requestLock();
  }

  requestLock() {
    this.controller.requestLock();
    // if the browser refuses (e.g. ESC pressed moments ago) the prompt appears
    setTimeout(() => {
      if (this.state.is(GameState.PLAYING, GameState.DEAD) && !this.controller.locked) {
        this.ui.resume.show();
      }
    }, 220);
  }

  /* ------------------------------------------------------------ death flow */

  onPlayerKilled(attacker) {
    this._killerName = attacker && attacker.name ? attacker.name : null;
    this.match.registerKill('B', {
      killer: this._killerName || 'THE FOUNDRY',
      victim: this.player.name,
      headshot: false,
      byPlayer: false
    });
    if (this.match.ended) return;
    this.state.set(GameState.DEAD);
    this._respawnTimer = RESPAWN_DELAY;
    this.ui.death.show(this._killerName);
    this.ui.death.setCountdown(RESPAWN_DELAY);
    this.audio.play('playerDeath', { volume: 0.8 });
    this.controller.state.firing = false;
  }

  respawnPlayer() {
    const enemies = this.enemyManager.enemies.filter((e) => e.alive);
    let spawn = this.map.getSpawn('A', enemies.length ? enemies[0].position : null, 22, true);
    // prefer a base spawn that no living enemy is standing near
    for (let tries = 0; tries < 8; tries++) {
      const candidate = this.map.getSpawn('A', null, 0, true);
      const tooClose = enemies.some((e) =>
        (e.position.x - candidate.x) ** 2 + (e.position.z - candidate.z) ** 2 < 18 * 18);
      if (!tooClose) { spawn = candidate; break; }
    }
    const yaw = Math.atan2(spawn.x, spawn.z);
    this.player.spawn(spawn, yaw);
    this.weapon.reset();
    this.ui.death.hide();
    this.state.set(GameState.PLAYING);
    this.audio.play('spawn', { volume: 0.5 });
  }

  onMatchEnd(match) {
    this.state.set(GameState.RESULTS);
    this.controller.setEnabled(false);
    this.controller.releaseLock();
    this.ui.death.hide();
    this.ui.resume.hide();
    this.hud.hide();
    const summary = match.getSummary();
    this.ui.results.show(summary);
    this.audio.play(summary.result === 'victory' ? 'victory' : 'defeat', { volume: 0.8 });
  }

  /* ================================================================== loop */

  _loop(now) {
    requestAnimationFrame(this._loop);
    const last = this._lastNow || now;
    this._lastNow = now;
    let dt = (now - last) / 1000;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, MAX_DT);

    // fps counter
    this._fpsAccum += dt;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsAccum);
      this._fpsAccum = 0;
      this._fpsFrames = 0;
      this.ui.settings.setFps(this.fps);
    }

    this.step(dt);
    this._render();
    this.frameCount++;
  }

  /**
   * Advance the simulation by `dt`. Split out of the frame loop so it can be
   * driven directly (headless stepping, debugging) without a rendered frame.
   */
  step(dt) {
    const st = this.state.current;
    if (st === GameState.PLAYING || st === GameState.DEAD) {
      this.time += dt;
      this._updateWorld(dt);
    } else if (st === GameState.RESULTS && this.built) {
      // keep the world alive behind the results panel
      this.time += dt;
      this.effects.update(dt);
      this.map.update(dt, this.player.position);
      this.enemyManager.update(dt);
      this.playerCamera.update(dt, this.player.eye, { strafe: 0, sprint: 0, grounded: true });
    }
  }

  _updateWorld(dt) {
    const input = this.controller.state;

    // ------------------------------------------------------------- respawn --
    if (this.state.is(GameState.DEAD)) {
      this._respawnTimer -= dt;
      this.ui.death.setCountdown(this._respawnTimer);
      if (this._respawnTimer <= 0) this.respawnPlayer();
    }

    // "click to engage" if the pointer lock was lost without pausing
    if (!this.controller.locked && !this.ui.resume.isOpen && !this.ui.pause.isOpen) {
      this.ui.resume.show();
    }

    this.player.update(dt, input);

    // camera first so the weapon fires along this frame's aim, not last frame's
    this.playerCamera.update(dt, this.player.eye, {
      strafe: input.strafe,
      sprint: this.player.sprinting ? 1 : 0,
      grounded: this.player.grounded
    });
    this.camera.updateMatrixWorld();
    this.playerCamera.getAimDirection(this.aimDir);

    this.weapon.update(dt, input);

    this.enemyManager.update(dt);
    this.effects.update(dt);
    this.map.update(dt, this.player.position);
    this.match.update(dt);

    this.audio.setListener(this.camera, this.player.eye);
    this.hud.update(dt);

    this.controller.endFrame();
  }

  _render() {
    const st = this.state.current;
    if (!this.built || st === GameState.MENU || st === GameState.LOADING) {
      this.renderer.clear();
      return;
    }
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.camera);
    // viewmodel pass: same camera origin, cleared depth
    if (this.player.alive || st === GameState.RESULTS) {
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.viewScene, this.viewCamera);
      this.renderer.autoClear = true;
    }
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.controller.dispose();
    if (this.weapon) this.weapon.dispose();
    if (this.enemyManager) this.enemyManager.dispose();
    if (this.effects) this.effects.dispose();
    if (this.map) this.map.dispose();
    this.renderer.dispose();
  }
}

export { GameState };
