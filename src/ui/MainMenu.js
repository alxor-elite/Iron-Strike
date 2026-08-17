/**
 * MainMenu plus the two shared panels (SETTINGS and CONTROLS) that both the
 * title screen and the pause menu open.
 */

const TIPS = [
  'Aim down sights (right mouse) to tighten your spread dramatically.',
  'Crouching reduces recoil and makes you much harder to spot.',
  'Sprinting is loud — enemies notice you from further away.',
  'Headshots are lethal in one round. Aim for the helmet line.',
  'The catwalks above the warehouse floor cover every main entrance.',
  'Reload the moment a fight ends, not the moment the next one starts.',
  'Enemies remember your last known position and will sweep it.',
  'Break line of sight to reset a fight you are losing.',
  'The annex rooftops overlook both approach lanes to the yards.',
  'Hold TAB to check the squad status and your accuracy.'
];

function wireButtons(root, handler, audio) {
  root.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      audio?.play('uiClick');
      handler(btn.dataset.action, btn);
    });
    btn.addEventListener('mouseenter', () => audio?.play('uiHover'));
  });
}

export class MainMenu {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('main-menu');
    wireButtons(this.el, (action) => this._onAction(action), game.audio);
    document.getElementById('build-tag').textContent = 'FOUNDRY-7 · v1.0.0';
  }

  _onAction(action) {
    const game = this.game;
    game.audio.init();
    switch (action) {
      case 'play':
        this.hide();
        game.startMatch();
        break;
      case 'controls':
        game.ui.controls.show(() => this.show());
        this.hide();
        break;
      case 'settings':
        game.ui.settings.show(() => this.show());
        this.hide();
        break;
      default: break;
    }
  }

  show() {
    this.el.classList.remove('hidden');
  }

  hide() {
    this.el.classList.add('hidden');
  }
}

/* ============================================================== settings == */

export class SettingsPanel {
  constructor(game) {
    this.game = game;
    this.settings = game.settings;
    this.el = document.getElementById('settings-menu');
    this._returnTo = null;

    this.sens = document.getElementById('set-sens');
    this.outSens = document.getElementById('out-sens');
    this.fov = document.getElementById('set-fov');
    this.outFov = document.getElementById('out-fov');
    this.volume = document.getElementById('set-volume');
    this.outVolume = document.getElementById('out-volume');
    this.quality = document.getElementById('set-quality');
    this.invert = document.getElementById('set-invert');
    this.shake = document.getElementById('set-shake');
    this.adsToggle = document.getElementById('set-adstoggle');
    this.fpsReadout = document.getElementById('fps-readout');

    this.syncFromSettings();

    this.sens.addEventListener('input', () => {
      const v = parseFloat(this.sens.value);
      this.outSens.textContent = v.toFixed(2);
      this.settings.set('sensitivity', v);
    });
    this.fov.addEventListener('input', () => {
      const v = parseInt(this.fov.value, 10);
      this.outFov.textContent = String(v);
      this.settings.set('fov', v);
    });
    this.volume.addEventListener('input', () => {
      const v = parseInt(this.volume.value, 10);
      this.outVolume.textContent = String(v);
      this.settings.set('volume', v / 100);
    });
    this.quality.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.game.audio.play('uiClick');
        this.settings.set('quality', btn.dataset.value);
        this._paintQuality();
      });
    });
    this.invert.addEventListener('change', () => this.settings.set('invertY', this.invert.checked));
    this.shake.addEventListener('change', () => this.settings.set('cameraShake', this.shake.checked));
    this.adsToggle.addEventListener('change', () => this.settings.set('adsToggle', this.adsToggle.checked));

    wireButtons(this.el, (action) => {
      if (action === 'back') this.hide();
      else if (action === 'reset') {
        this.settings.reset();
        this.syncFromSettings();
      }
    }, game.audio);
  }

  syncFromSettings() {
    const s = this.settings.values;
    this.sens.value = String(s.sensitivity);
    this.outSens.textContent = Number(s.sensitivity).toFixed(2);
    this.fov.value = String(s.fov);
    this.outFov.textContent = String(s.fov);
    this.volume.value = String(Math.round(s.volume * 100));
    this.outVolume.textContent = String(Math.round(s.volume * 100));
    this.invert.checked = !!s.invertY;
    this.shake.checked = !!s.cameraShake;
    this.adsToggle.checked = !!s.adsToggle;
    this._paintQuality();
  }

  _paintQuality() {
    const q = this.settings.get('quality');
    this.quality.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.value === q);
    });
  }

  show(returnTo) {
    this._returnTo = returnTo;
    this.syncFromSettings();
    this.el.classList.remove('hidden');
  }

  hide() {
    this.el.classList.add('hidden');
    const back = this._returnTo;
    this._returnTo = null;
    if (back) back();
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }

  setFps(fps) {
    if (this.isOpen) this.fpsReadout.textContent = String(fps);
  }
}

/* ============================================================== controls == */

export class ControlsPanel {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('controls-menu');
    this._returnTo = null;
    wireButtons(this.el, (action) => {
      if (action === 'back') this.hide();
    }, game.audio);
  }

  show(returnTo) {
    this._returnTo = returnTo;
    this.el.classList.remove('hidden');
  }

  hide() {
    this.el.classList.add('hidden');
    const back = this._returnTo;
    this._returnTo = null;
    if (back) back();
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }
}

export { TIPS, wireButtons };
