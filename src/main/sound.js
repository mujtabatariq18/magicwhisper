// ============================================
// MagicWhisper — Sound Feedback System
// ============================================
// Audio cues for recording start/stop,
// transcription complete, and errors.
// Uses Web Audio API-compatible oscillator tones
// generated in-process, no external audio files needed.
// ============================================

const { BrowserWindow } = require('electron');
const { logger } = require('./logger');

class SoundManager {
  constructor() {
    this.enabled = true;
    this._window = null;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    logger.debug('sound', `Sound feedback ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Set proxy window for playing sounds via renderer Web Audio.
   */
  setWindow(win) {
    this._window = win;
  }

  /**
   * Play a sound effect via the renderer process.
   * @param {'start'|'stop'|'success'|'error'} type
   */
  play(type) {
    if (!this.enabled) return;
    if (!this._window || this._window.isDestroyed()) return;

    try {
      // Inject a minimal Web Audio API call into the renderer
      const script = this._getSoundScript(type);
      this._window.webContents.executeJavaScript(script).catch(() => {});
    } catch (e) {
      // Silent fail — sound is non-critical
    }
  }

  _getSoundScript(type) {
    const sounds = {
      start: `(function(){
        try {
          const ctx = new AudioContext();
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.type = 'sine';
          o.frequency.setValueAtTime(880, ctx.currentTime);
          o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
          g.gain.setValueAtTime(0.15, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
          o.start(ctx.currentTime);
          o.stop(ctx.currentTime + 0.15);
          setTimeout(() => ctx.close(), 300);
        } catch(e){}
      })()`,

      stop: `(function(){
        try {
          const ctx = new AudioContext();
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.type = 'sine';
          o.frequency.setValueAtTime(1320, ctx.currentTime);
          o.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
          g.gain.setValueAtTime(0.15, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
          o.start(ctx.currentTime);
          o.stop(ctx.currentTime + 0.15);
          setTimeout(() => ctx.close(), 300);
        } catch(e){}
      })()`,

      success: `(function(){
        try {
          const ctx = new AudioContext();
          const play = (freq, start, dur) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.type = 'sine';
            o.frequency.value = freq;
            g.gain.setValueAtTime(0.12, ctx.currentTime + start);
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
            o.start(ctx.currentTime + start);
            o.stop(ctx.currentTime + start + dur);
          };
          play(523, 0, 0.12);
          play(659, 0.08, 0.12);
          play(784, 0.16, 0.18);
          setTimeout(() => ctx.close(), 600);
        } catch(e){}
      })()`,

      error: `(function(){
        try {
          const ctx = new AudioContext();
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g); g.connect(ctx.destination);
          o.type = 'square';
          o.frequency.setValueAtTime(220, ctx.currentTime);
          o.frequency.setValueAtTime(180, ctx.currentTime + 0.1);
          g.gain.setValueAtTime(0.08, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
          o.start(ctx.currentTime);
          o.stop(ctx.currentTime + 0.25);
          setTimeout(() => ctx.close(), 400);
        } catch(e){}
      })()`,

      milestone: `(function(){
        try {
          const ctx = new AudioContext();
          const play = (freq, start, dur) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.type = 'sine';
            o.frequency.value = freq;
            g.gain.setValueAtTime(0.1, ctx.currentTime + start);
            g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
            o.start(ctx.currentTime + start);
            o.stop(ctx.currentTime + start + dur);
          };
          play(523, 0, 0.15);
          play(659, 0.1, 0.15);
          play(784, 0.2, 0.15);
          play(1047, 0.3, 0.25);
          setTimeout(() => ctx.close(), 800);
        } catch(e){}
      })()`
    };

    return sounds[type] || '';
  }
}

module.exports = { SoundManager };
