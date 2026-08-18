/**
 * HUD — all in-match DOM overlay updates.
 *
 * Values are cached so the DOM is only touched when something actually changes,
 * which keeps the overlay off the hot path.
 */

import { formatTime, clamp } from '../utils/MathUtils.js';
import { Scoreboard } from './Scoreboard.js';

const KILLFEED_MAX = 5;
const KILLFEED_TTL = 5200;

export class HUD {
  constructor(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id);

    this.root = $('hud');
    this.healthFill = $('health-fill');
    this.healthValue = $('health-value');
    this.timer = $('match-timer');
    this.scoreA = $('score-a');
    this.scoreB = $('score-b');
    this.progA = $('score-prog-a');
    this.progB = $('score-prog-b');
    this.killfeed = $('killfeed');
    this.ammoMag = $('ammo-mag');
    this.ammoReserve = $('ammo-reserve');
    this.weaponName = $('weapon-name');
    this.reloadPrompt = $('reload-prompt');
    this.reloadTrack = $('reload-track');
    this.reloadFill = $('reload-fill');
    this.crosshair = $('crosshair');
    this.hitmarker = $('hitmarker');
    this.headshotBanner = $('headshot-banner');
    this.killpop = $('killpop');
    this.vignette = $('damage-vignette');
    this.tagSprint = $('tag-sprint');
    this.tagCrouch = $('tag-crouch');
    this.tagAds = $('tag-ads');
    this.hitdirs = {
      up: document.querySelector('.hitdir[data-dir="up"]'),
      down: document.querySelector('.hitdir[data-dir="down"]'),
      left: document.querySelector('.hitdir[data-dir="left"]'),
      right: document.querySelector('.hitdir[data-dir="right"]')
    };

    this.chParts = {
      t: this.crosshair.querySelector('.ch-t'),
      b: this.crosshair.querySelector('.ch-b'),
      l: this.crosshair.querySelector('.ch-l'),
      r: this.crosshair.querySelector('.ch-r')
    };

    this.scoreboard = new Scoreboard(game, $('scoreboard'));

    this._cache = {
      health: -1, timer: '', scoreA: -1, scoreB: -1,
      ammo: -1, reserve: -1, spread: -1, enemyTint: null,
      sprint: null, crouch: null, ads: null
    };
    this._feed = [];
    this._vignetteTimer = -2;
    this._lowHealthVignette = false;
    this._hitdirTimers = { up: 0, down: 0, left: 0, right: 0 };
    this._bannerTimer = 0;

    this.weaponName.textContent = '—';
  }

  show() {
    this.root.classList.remove('hidden');
    this.root.setAttribute('aria-hidden', 'false');
  }

  hide() {
    this.root.classList.add('hidden');
    this.root.setAttribute('aria-hidden', 'true');
    this.scoreboard.hide();
  }

  reset() {
    this._feed.forEach((f) => f.el.remove());
    this._feed.length = 0;
    this.killfeed.innerHTML = '';
    this.vignette.style.opacity = '0';
    this._vignetteTimer = -2;
    this._lowHealthVignette = false;
    this._cache.health = -1;
    this._cache.scoreA = -1;
    this._cache.scoreB = -1;
    this._cache.ammo = -1;
    Object.keys(this.hitdirs).forEach((k) => {
      this.hitdirs[k].classList.remove('on');
      this._hitdirTimers[k] = 0;
    });
  }

  /* ------------------------------------------------------------- per frame */

  update(dt) {
    const game = this.game;
    const player = game.player;
    const weapon = game.weapon;

    // ---- health ----
    const hp = Math.max(0, Math.round(player.health));
    if (hp !== this._cache.health) {
      this._cache.health = hp;
      this.healthValue.textContent = String(hp);
      const pct = clamp(hp / player.maxHealth, 0, 1) * 100;
      this.healthFill.style.width = `${pct}%`;
      this.healthFill.className = 'health-fill' +
        (hp <= 25 ? ' critical' : hp <= 60 ? ' hurt' : '');
    }

    // ---- ammo ----
    if (weapon) {
      // a melee weapon has no rounds to count
      const mag = weapon.melee ? '—' : String(weapon.ammo);
      const reserve = weapon.melee ? '—' : String(weapon.reserve);
      if (mag !== this._cache.ammo) {
        this._cache.ammo = mag;
        this.ammoMag.textContent = mag;
        this.ammoMag.classList.toggle('low', !weapon.melee && weapon.ammo <= 7);
      }
      if (reserve !== this._cache.reserve) {
        this._cache.reserve = reserve;
        this.ammoReserve.textContent = reserve;
      }
      const needReload = !weapon.melee && !weapon.reloading && weapon.ammo <= 5 && weapon.reserve > 0;
      this.reloadPrompt.classList.toggle('on', needReload);
      if (weapon.reloading) {
        this.reloadTrack.classList.add('on');
        this.reloadFill.style.width = `${clamp(weapon.reloadT / weapon.reloadTime, 0, 1) * 100}%`;
      } else {
        this.reloadTrack.classList.remove('on');
      }

      // ---- crosshair spread + enemy tint ----
      const spreadPx = Math.round(6 + weapon.getSpread() * 620);
      if (spreadPx !== this._cache.spread) {
        this._cache.spread = spreadPx;
        this.chParts.t.style.transform = `translateY(${-spreadPx}px)`;
        this.chParts.b.style.transform = `translateY(${spreadPx}px)`;
        this.chParts.l.style.transform = `translateX(${-spreadPx}px)`;
        this.chParts.r.style.transform = `translateX(${spreadPx}px)`;
      }
      const hideCh = weapon.adsAmount > 0.7;
      this.crosshair.classList.toggle('hide-ch', hideCh);
    }

    // enemy under crosshair -> red crosshair
    const enemy = game.enemyManager.getEnemyUnderCrosshair(game.camera.position, game.aimDir);
    const tint = enemy ? true : false;
    if (tint !== this._cache.enemyTint) {
      this._cache.enemyTint = tint;
      this.crosshair.classList.toggle('enemy', tint);
    }

    // ---- state tags ----
    if (player.sprinting !== this._cache.sprint) {
      this._cache.sprint = player.sprinting;
      this.tagSprint.classList.toggle('on', player.sprinting);
    }
    if (player.crouching !== this._cache.crouch) {
      this._cache.crouch = player.crouching;
      this.tagCrouch.classList.toggle('on', player.crouching);
    }
    const ads = weapon ? weapon.adsAmount > 0.5 : false;
    if (ads !== this._cache.ads) {
      this._cache.ads = ads;
      this.tagAds.classList.toggle('on', ads);
    }

    // ---- damage vignette + low-health pulse ----
    if (this._vignetteTimer > 0) {
      this._vignetteTimer -= dt;
    } else if (player.alive && player.health < 30) {
      this.vignette.style.opacity = String(0.18 + Math.sin(game.time * 5) * 0.08);
      this._lowHealthVignette = true;
    } else if (this._lowHealthVignette || this._vignetteTimer > -1) {
      // clear once, whether the hit flash expired or health came back up
      this.vignette.style.opacity = '0';
      this._lowHealthVignette = false;
      this._vignetteTimer = -2;
    }

    // ---- hit direction indicators ----
    for (const key of Object.keys(this._hitdirTimers)) {
      if (this._hitdirTimers[key] > 0) {
        this._hitdirTimers[key] -= dt;
        if (this._hitdirTimers[key] <= 0) this.hitdirs[key].classList.remove('on');
      }
    }

    // ---- kill feed expiry ----
    const now = performance.now();
    for (let i = this._feed.length - 1; i >= 0; i--) {
      const f = this._feed[i];
      if (now - f.born > KILLFEED_TTL) {
        f.el.classList.add('out');
        if (now - f.born > KILLFEED_TTL + 450) {
          f.el.remove();
          this._feed.splice(i, 1);
        }
      }
    }

    // ---- banner ----
    if (this._bannerTimer > 0) {
      this._bannerTimer -= dt;
      if (this._bannerTimer <= 0) this.killpop.classList.remove('show');
    }

    // ---- scoreboard ----
    this.scoreboard.setVisible(game.controller.state.scoreboard && game.state.is('PLAYING', 'DEAD'));
    this.scoreboard.update(dt);
  }

  /* --------------------------------------------------------------- setters */

  setWeaponName(name) {
    this.weaponName.textContent = name;
  }

  setTimer(seconds) {
    const txt = formatTime(seconds);
    if (txt !== this._cache.timer) {
      this._cache.timer = txt;
      this.timer.textContent = txt;
      this.timer.classList.toggle('urgent', seconds <= 30);
    }
  }

  setScores(a, b, limit) {
    if (a !== this._cache.scoreA) {
      this._cache.scoreA = a;
      this.scoreA.textContent = String(a);
      this.progA.style.width = `${clamp(a / limit, 0, 1) * 50}%`;
    }
    if (b !== this._cache.scoreB) {
      this._cache.scoreB = b;
      this.scoreB.textContent = String(b);
      this.progB.style.width = `${clamp(b / limit, 0, 1) * 50}%`;
    }
  }

  /* ----------------------------------------------------------- indicators */

  showHitMarker(headshot, killed) {
    const el = this.hitmarker;
    el.classList.remove('show');
    el.classList.toggle('kill', !!killed);
    // force a reflow so the animation restarts on rapid hits
    void el.offsetWidth;
    el.classList.add('show');
    if (headshot) {
      const b = this.headshotBanner;
      b.classList.remove('show');
      void b.offsetWidth;
      b.classList.add('show');
    }
  }

  showKillPopup(victim, headshot) {
    this.killpop.textContent = `${headshot ? 'HEADSHOT · ' : ''}ELIMINATED ${victim}`;
    this.killpop.classList.remove('show');
    void this.killpop.offsetWidth;
    this.killpop.classList.add('show');
    this._bannerTimer = 1.2;
  }

  showBanner(text) {
    this.killpop.textContent = text;
    this.killpop.classList.remove('show');
    void this.killpop.offsetWidth;
    this.killpop.classList.add('show');
    this._bannerTimer = 1.4;
  }

  flashDamage(amount) {
    const strength = clamp(0.25 + amount / 60, 0.25, 0.85);
    this.vignette.style.opacity = String(strength);
    this._vignetteTimer = 0.42;
  }

  /**
   * @param {number} relAngle bearing of the attacker relative to the player's
   * facing: 0 = dead ahead, ±π = behind, positive = to the left.
   */
  showHitDirection(relAngle) {
    let a = relAngle;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    const abs = Math.abs(a);
    let key;
    if (abs < 0.79) key = 'up';          // in front
    else if (abs > 2.36) key = 'down';   // behind
    else key = a > 0 ? 'left' : 'right';
    this.hitdirs[key].classList.add('on');
    this._hitdirTimers[key] = 1.0;
  }

  addKillFeed(team, info) {
    const el = document.createElement('div');
    el.className = 'kf-row' + (info.byPlayer || info.victim === 'YOU' ? ' mine' : '');
    const killerClass = team === 'A' ? 'kf-a' : 'kf-b';
    const victimClass = team === 'A' ? 'kf-b' : 'kf-a';
    el.innerHTML =
      `<span class="${killerClass}">${escapeHtml(info.killer)}</span>` +
      `<span class="kf-icon">${info.headshot ? '<span class="kf-hs">✚</span>' : '➜'}</span>` +
      `<span class="${victimClass}">${escapeHtml(info.victim)}</span>`;
    this.killfeed.appendChild(el);
    this._feed.push({ el, born: performance.now() });
    while (this._feed.length > KILLFEED_MAX) {
      const old = this._feed.shift();
      old.el.remove();
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
