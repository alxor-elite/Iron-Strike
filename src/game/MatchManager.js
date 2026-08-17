/**
 * MatchManager — Team Deathmatch rules.
 *
 * Two teams: RAVEN (the player) and VULTURE (the AI squad). Every AI you drop
 * scores for RAVEN; every time you go down scores for VULTURE. First to the
 * score limit wins, otherwise the higher score when the clock expires does.
 */

export const TEAM = { A: 'A', B: 'B' };
export const TEAM_NAMES = { A: 'RAVEN', B: 'VULTURE' };

export class MatchManager {
  constructor(game, options = {}) {
    this.game = game;
    this.scoreLimit = options.scoreLimit || 30;
    this.duration = options.duration || 300; // seconds

    this.scores = { A: 0, B: 0 };
    this.timeLeft = this.duration;
    this.running = false;
    this.ended = false;
    this.result = null;       // 'victory' | 'defeat' | 'draw'
    this.endReason = null;    // 'score' | 'time'
    this.elapsed = 0;
    this.killLog = [];
    this._lastTick = -1;
    this._warned = false;
  }

  start() {
    this.scores.A = 0;
    this.scores.B = 0;
    this.timeLeft = this.duration;
    this.elapsed = 0;
    this.running = true;
    this.ended = false;
    this.result = null;
    this.endReason = null;
    this.killLog.length = 0;
    this._lastTick = -1;
    this._warned = false;
    this.game.hud.setScores(0, 0, this.scoreLimit);
    this.game.hud.setTimer(this.timeLeft);
    this.game.audio.play('matchStart', { volume: 0.6 });
  }

  stop() {
    this.running = false;
  }

  /**
   * @param {'A'|'B'} team
   * @param {{killer:string, victim:string, headshot?:boolean, byPlayer?:boolean}} info
   */
  registerKill(team, info) {
    if (!this.running) return;
    this.scores[team]++;
    this.killLog.push({ team, ...info, at: this.elapsed });
    this.game.hud.addKillFeed(team, info);
    this.game.hud.setScores(this.scores.A, this.scores.B, this.scoreLimit);

    if (this.scores[team] >= this.scoreLimit) {
      this.end('score');
    } else if (this.scoreLimit - this.scores[team] === 1) {
      this.game.hud.showBanner(
        team === 'A' ? 'ONE KILL FROM VICTORY' : 'ENEMY ONE KILL FROM VICTORY'
      );
    }
  }

  update(dt) {
    if (!this.running) return;
    this.elapsed += dt;
    this.timeLeft = Math.max(0, this.timeLeft - dt);

    const whole = Math.ceil(this.timeLeft);
    if (whole !== this._lastTick) {
      this._lastTick = whole;
      this.game.hud.setTimer(this.timeLeft);
      if (whole <= 10 && whole > 0) {
        this.game.audio.play('countdown', { volume: 0.35 });
      }
    }
    if (!this._warned && this.timeLeft <= 30) {
      this._warned = true;
      this.game.hud.showBanner('30 SECONDS REMAINING');
    }

    if (this.timeLeft <= 0) this.end('time');
  }

  end(reason) {
    if (this.ended) return;
    this.ended = true;
    this.running = false;
    this.endReason = reason;
    if (this.scores.A > this.scores.B) this.result = 'victory';
    else if (this.scores.B > this.scores.A) this.result = 'defeat';
    else this.result = 'draw';
    this.game.onMatchEnd(this);
  }

  getSummary() {
    const p = this.game.player.stats;
    const accuracy = p.shotsFired > 0 ? (p.hits / p.shotsFired) * 100 : 0;
    return {
      scoreA: this.scores.A,
      scoreB: this.scores.B,
      result: this.result,
      reason: this.endReason,
      kills: p.kills,
      deaths: p.deaths,
      headshots: p.headshots,
      accuracy,
      kd: p.deaths > 0 ? p.kills / p.deaths : p.kills,
      damage: Math.round(p.damageDealt),
      duration: this.duration - this.timeLeft
    };
  }
}
