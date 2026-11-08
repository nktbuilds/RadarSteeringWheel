// Steering DSP pipeline.
//
// Consumes per-frame amplitude/phase arrays (one entry per distance bin) and
// derives a wheel angle from the radial motion of the hands.
//
// Pipeline per frame:
//   1. Find up to two amplitude peaks = the two hands, and lock onto them so the
//      bin assignment does not hop frame to frame.
//   2. Unwrap the phase at each hand bin and convert to radial millimetres,
//      d = Δφ · λ / (4π).
//   3. Differential = (far hand) − (near hand): a turn pushes one hand toward
//      the radar and the other away, so the sign tracks the turn direction.
//   4. Subtract a slow "wheel centered" baseline and scale to degrees.
//   5. Hold the last angle through brief drops; blank only on true hand loss.

import { STEERING, WAVELENGTH_M, MAX_WHEEL_ANGLE_DEG } from '../config.js';

const TWO_PI = 2 * Math.PI;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function hasValley(amps, a, b, valleyRatio) {
  if (!(valleyRatio > 0 && valleyRatio < 1)) return true;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const limit = Math.min(amps[a], amps[b]) * valleyRatio;
  for (let i = lo + 1; i < hi; i++) {
    if (amps[i] <= limit) return true;
  }
  return false;
}

function findPeaks(amps, { minAmp, minGap, maxPeaks, valleyRatio = 0 }) {
  const peaks = [];
  for (let i = 1; i < amps.length - 1; i++) {
    if (amps[i] >= amps[i - 1] && amps[i] >= amps[i + 1] && amps[i] >= minAmp) peaks.push(i);
  }
  peaks.sort((a, b) => amps[b] - amps[a]);
  const chosen = [];
  for (const p of peaks) {
    if (chosen.every((c) => Math.abs(c - p) >= minGap && hasValley(amps, c, p, valleyRatio))) {
      chosen.push(p);
    }
    if (chosen.length >= maxPeaks) break;
  }
  chosen.sort((a, b) => a - b);
  return chosen;
}

export class SteeringProcessor {
  constructor(opts = {}) {
    this.cfg = { ...STEERING, ...opts };
    this.wavelengthM = opts.wavelengthM ?? WAVELENGTH_M;
    this.maxAngleDeg = opts.maxAngleDeg ?? MAX_WHEEL_ANGLE_DEG;
    this.maxLen = opts.maxLen ?? 400;
    this.stepM = opts.stepM ?? 0.02;
    this.fs = 20;
    this.reset();
  }

  setSampleRate(fs) {
    if (Number.isFinite(fs) && fs > 0) this.fs = fs;
  }

  // Distance between adjacent range bins, in metres (step_length * base_step).
  setRangeSpacing(stepM) {
    if (Number.isFinite(stepM) && stepM > 0) this.stepM = stepM;
  }

  // Live tuning from the UI, without a reset.
  setConfig(opts = {}) {
    if (Number.isFinite(opts.angleGainDegPerMm)) this.cfg.angleGainDegPerMm = opts.angleGainDegPerMm;
    if (Number.isFinite(opts.smoothingSeconds)) this.cfg.smoothingSeconds = opts.smoothingSeconds;
    if (Number.isFinite(opts.ampSmoothing)) {
      this.cfg.ampSmoothing = Math.max(0.01, Math.min(0.99, opts.ampSmoothing));
    }
    if (Number.isFinite(opts.baselineSeconds)) {
      this.cfg.baselineSeconds = Math.max(0.001, opts.baselineSeconds);
    }
    if (typeof opts.invertDirection === 'boolean') this.cfg.invertDirection = opts.invertDirection;
    if (typeof opts.baselineHold === 'boolean') this.cfg.baselineHold = opts.baselineHold;
    if (typeof opts.singleHandMode === 'boolean' && opts.singleHandMode !== this.cfg.singleHandMode) {
      this.cfg.singleHandMode = opts.singleHandMode;
      if (opts.singleHandMode && this.hands.length > 1) this.hands.length = 1;
      this._rezero = true;
    }
    if (
      typeof opts.centroidPosition === 'boolean' &&
      opts.centroidPosition !== this.cfg.centroidPosition
    ) {
      this.cfg.centroidPosition = opts.centroidPosition;
      // The two sources measure different things, so re-centre on the switch.
      for (const hand of this.hands) hand.prevPhase = null;
      this._rezero = true;
    }
    if (Number.isFinite(opts.binSmoothing)) {
      this.cfg.binSmoothing = Math.max(0.01, Math.min(0.99, opts.binSmoothing));
    }
    if (Number.isFinite(opts.binHysteresis)) {
      this.cfg.binHysteresis = Math.max(0, Math.min(0.9, opts.binHysteresis));
    }
  }

  // Re-zero the "wheel centered" baseline to the current hand positions.
  recenter() {
    this.baseline = NaN;
  }

  reset() {
    this.hands = [];
    this.baseline = NaN;
    this.angleDeg = 0;
    this.differentialMm = 0;
    this.turnMm = 0;
    this._missingSeconds = 0;
    this._blanked = true;
    this._history = { differential: [], near: [], far: [] };
    this._events = [];
    this.samples = 0;
    this._prevMode = 'none';
    this._meaningMode = null;
    this._rezero = false;
    this._ampSmooth = null;
    this._peaks = [];
    this._candidateBin = null;
    this._candidateFrames = 0;
  }

  // Sub-bin position of a peak from an amplitude-weighted centroid over a small
  // window. Continuous, so the bin assignment can be smoothed before rounding.
  _binCentroid(amps, p) {
    const lo = Math.max(0, p - 1);
    const hi = Math.min(amps.length - 1, p + 1);
    let num = 0;
    let den = 0;
    for (let b = lo; b <= hi; b++) {
      num += b * amps[b];
      den += amps[b];
    }
    return den > 0 ? num / den : p;
  }

  _updateHandBin(hand, smooth, bin) {
    const centroid = this._binCentroid(smooth, bin);
    // Alpha-beta tracker: estimates position AND velocity, so a hand moving at
    // a steady speed is followed with no lag. A plain EMA falls a fixed number
    // of frames behind, and at hand speed that is centimetres - which starves
    // the match test below and makes the hand drop out mid-move.
    const alpha = this.cfg.binSmoothing;
    const beta = this.cfg.posBeta > 0 ? this.cfg.posBeta : (alpha * alpha) / (2 - alpha);
    if (hand.pos == null) {
      hand.pos = centroid;
      hand.vel = 0;
    } else {
      const predicted = hand.pos + (hand.vel ?? 0);
      const residual = centroid - predicted;
      hand.pos = predicted + alpha * residual;
      hand.vel = (hand.vel ?? 0) + beta * residual;
    }
    let newBin = hand.bin;
    const margin = 0.5 + this.cfg.binHysteresis;
    if (hand.pos - hand.bin >= margin || hand.bin - hand.pos >= margin) {
      newBin = Math.round(hand.pos);
    }
    hand.binDelta = newBin - hand.bin;
    if (newBin !== hand.bin) hand.rebase = true;
    hand.bin = newBin;
    hand.missing = 0;
  }

  _trackHands(amps) {
    if (!this._ampSmooth || this._ampSmooth.length !== amps.length) {
      this._ampSmooth = Float64Array.from(amps);
    } else {
      const a = this.cfg.ampSmoothing;
      for (let b = 0; b < amps.length; b++) {
        this._ampSmooth[b] += (amps[b] - this._ampSmooth[b]) * a;
      }
    }
    const smooth = this._ampSmooth;

    let maxAmp = 0;
    for (const v of smooth) if (v > maxAmp) maxAmp = v;
    const acquireAmp = Math.max(this.cfg.minHandAmp, maxAmp * this.cfg.peakRatio);
    this._acquireAmp = acquireAmp;

    this._peaks = findPeaks(smooth, {
      minAmp: maxAmp * 0.05,
      minGap: this.cfg.minPeakGapBins,
      maxPeaks: 5,
      valleyRatio: this.cfg.valleyRatio,
    }).map((b) => ({ bin: b, amp: smooth[b] }));

    const peaks = findPeaks(smooth, {
      minAmp: acquireAmp,
      minGap: this.cfg.minPeakGapBins,
      maxPeaks: 4,
      valleyRatio: this.cfg.valleyRatio,
    });

    const used = new Set();
    for (const hand of this.hands) {
      let best = -1;
      let bestDist = Infinity;
      for (const p of peaks) {
        if (used.has(p)) continue;
        // Match against the tracker's one-frame-ahead estimate: the filtered
        // position itself lags while the hand is speeding up, and that lag is
        // what pushes a moving hand outside the radius and strands it.
        const d = Math.abs(p - (hand.pos == null ? hand.bin : hand.pos + (hand.vel ?? 0)));
        if (d <= this.cfg.matchRadiusBins && d < bestDist) {
          bestDist = d;
          best = p;
        }
      }
      if (best >= 0) {
        used.add(best);
        this._updateHandBin(hand, smooth, best);
      } else {
        hand.missing++;
      }
    }

    const surviving = [];
    const holdFrames = this.cfg.singleHandMode
      ? this.cfg.singleHoldFrames
      : this.cfg.holdFrames;
    for (const hand of this.hands) {
      if (hand.missing > holdFrames) {
        this._events.push({ type: 'lost', bin: hand.bin });
      } else {
        surviving.push(hand);
      }
    }
    this.hands = surviving;

    // Lock a new hand only after the candidate peak persists, so a transient
    // (or a decaying ghost from the amplitude smoothing) cannot claim a hand.
    const maxHands = this.cfg.singleHandMode ? 1 : 2;
    const eligible = peaks.filter(
      (p) =>
        !used.has(p) &&
        this.hands.length < maxHands &&
        this.hands.every(
          (h) =>
            Math.abs(h.bin - p) >= this.cfg.minPeakGapBins &&
            hasValley(smooth, h.bin, p, this.cfg.valleyRatio),
        ),
    );
    const candidate = this.cfg.singleHandMode
      ? eligible.reduce((best, p) => (best == null || smooth[p] > smooth[best] ? p : best), null)
      : eligible[0] ?? null;
    // Let a candidate drift while it persists. A hand that is genuinely moving
    // walks its peak a bin or more per frame, so a fixed radius resets its
    // progress every frame and it can never lock while in motion - the wheel
    // then sits still while the peak visibly moves.
    const candRadius =
      (this.cfg.candidateRadiusBins ?? 2) +
      this._candidateFrames * (this.cfg.candidateDriftBins ?? 1);
    if (candidate == null) {
      this._candidateBin = null;
      this._candidateFrames = 0;
    } else if (this._candidateBin != null && Math.abs(candidate - this._candidateBin) <= candRadius) {
      this._candidateFrames++;
      this._candidateBin = candidate;
    } else {
      this._candidateBin = candidate;
      this._candidateFrames = 1;
    }

    if (candidate != null && this._candidateFrames >= this.cfg.lockFrames) {
      used.add(candidate);
      // A re-locked hand restarts its phase accumulation at zero, so the
      // relative reference has to move with it. The centroid range is absolute,
      // so it must not.
      if (!this.cfg.centroidPosition) this._rezero = true;
      const pos = this._binCentroid(smooth, candidate);
      this.hands.push({
        bin: candidate,
        pos,
        range0: pos * this.stepM * 1000,
        prevPhase: null,
        unwrapped: 0,
        dispMm: 0,
        amp: amps[candidate],
        missing: 0,
        rebase: true,
        binDelta: 0,
      });
      this._candidateBin = null;
      this._candidateFrames = 0;
    }
  }

  _updatePhases(amps, phases) {
    const mmPerRad = (this.wavelengthM / (4 * Math.PI)) * 1000;
    const radPerBin = (this.stepM * 4 * Math.PI) / this.wavelengthM;
    const centroid = this.cfg.centroidPosition;
    for (const hand of this.hands) {
      if (centroid) {
        // Absolute range from the amplitude envelope: continuous, and measured
        // from the radar rather than from when the hand locked, so a re-lock or
        // a dropout cannot move the wheel's centre.
        hand.rangeMm = hand.pos * this.stepM * 1000;
        hand.dispMm = hand.rangeMm - (hand.range0 ?? hand.rangeMm);
        hand.amp = amps[hand.bin];
        continue;
      }
      const raw = phases[hand.bin];
      if (hand.rebase || hand.prevPhase === null) {
        // A bin hop is real radial motion: fold the bin step into the total,
        // then adopt the new bin's phase reference without a phase step.
        if (hand.prevPhase !== null && hand.binDelta) {
          hand.unwrapped += hand.binDelta * radPerBin;
        }
        hand.rebase = false;
      } else {
        let d = raw - hand.prevPhase;
        if (d > Math.PI) d -= TWO_PI;
        else if (d < -Math.PI) d += TWO_PI;
        hand.unwrapped += d;
      }
      hand.prevPhase = raw;
      hand.dispMm = hand.unwrapped * mmPerRad;
      hand.rangeMm = hand.dispMm;
      hand.amp = amps[hand.bin];
    }
    this.hands.sort((a, b) => a.bin - b.bin);
  }

  _smoothAngle(target, dt) {
    const prev = this.angleDeg;
    const tau = this.cfg.smoothingSeconds;
    const alpha = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
    let next = prev + (target - prev) * alpha;
    const maxStep = this.cfg.maxSlewDegPerSec * dt;
    if (next - prev > maxStep) next = prev + maxStep;
    else if (prev - next > maxStep) next = prev - maxStep;
    return next;
  }

  _pushHistory(key, value) {
    const arr = this._history[key];
    const held = Number.isFinite(value) ? value : arr.length ? arr[arr.length - 1] : 0;
    arr.push(held);
    if (arr.length > this.maxLen) arr.shift();
  }

  process({ amplitudes, phases }) {
    this.samples++;
    this._trackHands(amplitudes);
    this._updatePhases(amplitudes, phases);

    const near = this.hands[0] ?? null;
    const far = this.hands[1] ?? null;

    let differential = null;
    let mode = 'none';
    if (near && far) {
      differential = far.rangeMm - near.rangeMm;
      mode = 'differential';
    } else if (near) {
      differential = near.rangeMm;
      mode = 'single';
    }

    if (mode !== this._prevMode) {
      this._events.push({ type: 'mode', from: this._prevMode, to: mode });
    }
    // The zero only moves when what is being measured changes meaning: one
    // hand's range versus the two hands' separation. A hand dropping out and
    // coming back is the same measurement, so it must not re-centre the wheel.
    if (mode !== 'none' && this._meaningMode != null && mode !== this._meaningMode) {
      this._rezero = true;
    }
    if (mode !== 'none') this._meaningMode = mode;
    this._prevMode = mode;

    const dt = 1 / this.fs;
    if (differential !== null) {
      if (this._rezero) {
        this.baseline = differential;
        this._rezero = false;
      }
      const alpha = this.cfg.baselineHold ? 0 : 1 - Math.exp(-dt / this.cfg.baselineSeconds);
      this.baseline = Number.isFinite(this.baseline)
        ? this.baseline + (differential - this.baseline) * alpha
        : differential;
      const rawMm = differential - this.baseline;
      this.differentialMm = differential;
      this.turnMm = rawMm;
      const sign = this.cfg.invertDirection ? -1 : 1;
      const target = clamp(
        sign * rawMm * this.cfg.angleGainDegPerMm,
        -this.maxAngleDeg,
        this.maxAngleDeg,
      );
      this.angleDeg = this._smoothAngle(target, dt);
      this._missingSeconds = 0;
      this._blanked = false;
    } else {
      this._missingSeconds += dt;
      if (this._missingSeconds > this.cfg.blankSeconds) this._blanked = true;
    }

    this._pushHistory('differential', differential === null ? null : this.turnMm);
    this._pushHistory('near', near ? near.dispMm : null);
    this._pushHistory('far', far ? far.dispMm : null);

    const confidence = this._blanked ? 0 : mode === 'differential' ? 1 : 0.5;

    const result = {
      amplitudes,
      smoothed: this._ampSmooth ? Array.from(this._ampSmooth) : [],
      angleDeg: this.angleDeg,
      differentialMm: this.differentialMm,
      turnMm: this.turnMm,
      threshold: this._acquireAmp ?? 0,
      peaks: this._peaks ?? [],
      candidate: this._candidateBin == null
        ? null
        : { bin: this._candidateBin, frames: this._candidateFrames, need: this.cfg.lockFrames },
      mode,
      blanked: this._blanked,
      confidence,
      hands: {
        near: near ? { bin: near.bin, amp: near.amp, dispMm: near.dispMm } : null,
        far: far ? { bin: far.bin, amp: far.amp, dispMm: far.dispMm } : null,
      },
      history: {
        differential: this._history.differential.slice(),
        near: this._history.near.slice(),
        far: this._history.far.slice(),
      },
      samples: this.samples,
      events: this._events,
    };
    this._events = [];
    return result;
  }
}
