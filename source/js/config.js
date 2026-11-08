// Central configuration defaults, allowed ranges and validation.

export const BAUD_RATES = [115200, 256000, 460800, 576000];

// The SparkFun XM125 board has no hardware flow control; higher rates
// overflow the RX buffer and corrupt the JSON header stream.
export const MAX_STABLE_BAUD = 460800;
export const HANDSHAKE_BAUD = 115200;

export const DEFAULTS = {
  baudRate: MAX_STABLE_BAUD,
  startPoint: 100,
  numPoints: 40,
  stepLength: 8,
  profile: 3,
  hwaas: 32,
  receiverGain: 16,
  updateRate: 20,
};

export const LIMITS = {
  startPoint: { min: -275, max: 1000, step: 1 },
  numPoints: { min: 1, max: 160, step: 1 },
  stepLength: { min: 1, max: 48, step: 1 },
  profile: { min: 1, max: 5, step: 1 },
  hwaas: { min: 1, max: 511, step: 1 },
  receiverGain: { min: 0, max: 23, step: 1 },
  updateRate: { min: 1, max: 100, step: 1 },
};

// Sparse IQ requires step_length to divide or be a multiple of 24.
export const SPARSE_IQ_PPC = 24;

export function isValidStepLength(step) {
  if (!Number.isInteger(step) || step < 1) return false;
  return SPARSE_IQ_PPC % step === 0 || step % SPARSE_IQ_PPC === 0;
}

export function validateConfig(cfg) {
  const errors = [];

  if (!BAUD_RATES.includes(cfg.baudRate)) {
    errors.push(`Baud rate ${cfg.baudRate} is not supported.`);
  }
  if (cfg.baudRate > MAX_STABLE_BAUD) {
    errors.push(`Baud rate above ${MAX_STABLE_BAUD} is unstable without flow control.`);
  }
  if (!isValidStepLength(cfg.stepLength)) {
    errors.push(`Step length must divide or be a multiple of ${SPARSE_IQ_PPC}.`);
  }
  for (const key of Object.keys(LIMITS)) {
    const { min, max } = LIMITS[key];
    const value = cfg[key];
    if (!Number.isFinite(value) || value < min || value > max) {
      errors.push(`${key} must be between ${min} and ${max}.`);
    }
  }
  if (cfg.updateRate <= 0) {
    errors.push('Update rate must be positive.');
  }

  return errors;
}

export function readConfigFromForm(form) {
  const get = (name) => Number(form.elements[name].value);
  return {
    baudRate: get('baudRate'),
    startPoint: get('startPoint'),
    numPoints: get('numPoints'),
    stepLength: get('stepLength'),
    profile: get('profile'),
    hwaas: get('hwaas'),
    receiverGain: get('receiverGain'),
    updateRate: get('updateRate'),
  };
}

// Nominal base step of the A121 discrete distance scale (~2.5 mm).
// The exact value is reported by the server as base_step_length_m once connected.
export const NOMINAL_BASE_STEP_M = 0.0025;

export function computeRangeWindow(cfg) {
  const base = NOMINAL_BASE_STEP_M;
  const spacingM = cfg.stepLength * base;
  const nearM = cfg.startPoint * base;
  const farM = (cfg.startPoint + (cfg.numPoints - 1) * cfg.stepLength) * base;
  return {
    nearM,
    farM,
    spacingM,
    binCount: cfg.numPoints,
    valid: isValidStepLength(cfg.stepLength),
  };
}

// Recommended starting configuration for hands on a wheel ~0.3-0.8 m away.
// startPoint 100 (≈0.25 m) + 40 bins × 20 mm spans ≈ 0.25-1.03 m, covering the
// whole steering arc so the hands stay inside the window at every turn angle.
export const HANDS_PRESET = {
  startPoint: 100,
  numPoints: 40,
  stepLength: 8,
  profile: 3,
  hwaas: 32,
  receiverGain: 16,
  updateRate: 20,
};

// 60 GHz radar: lambda = c / f ≈ 4.96 mm. Phase encodes radial motion only,
// d = Δφ · λ / (4π), so a turn must have a radial component to be visible.
export const WAVELENGTH_M = 0.00496;

// A wheel can be read over a full turn: clockwise positive, counter-clockwise
// negative, clamped at ±180°.
export const MAX_WHEEL_ANGLE_DEG = 180;

export const STEERING = {
  // Drive from a single hand's radial distance instead of the two-hand
  // differential. Only one peak is tracked, so any second hand is ignored.
  singleHandMode: false,
  // Absolute amplitude floor for a hand peak, plus a fraction of the strongest
  // peak in the frame. Both must be cleared, so a weak reflection never locks.
  minHandAmp: 120,
  peakRatio: 0.12,
  // Two peaks count as separate hands only if the spectrum dips between them to
  // at most this fraction of the weaker peak. Stops a broad single-hand blob
  // from being split into two fake hands when the thresholds are low.
  valleyRatio: 0.72,
  // Per-bin EMA on the amplitude spectrum before peak detection. Hand
  // reflections flicker frame to frame; smoothing stabilises the peak bins.
  ampSmoothing: 0.3,
  // Two peaks closer than this many bins are treated as one hand.
  minPeakGapBins: 3,
  // Where the hand's radial position comes from. The unwrapped phase carries no
  // usable motion on this hardware (it measures as noise), so the only position
  // signal that is not quantised to whole range bins is the continuous
  // amplitude centroid. On = centroid, smooth. Off = bin steps + phase, which
  // moves in 20 mm jumps.
  centroidPosition: true,
  // Alpha-beta tracker gain on the hand's range (position + velocity). Higher
  // follows the hand faster; lower is steadier. Feeds both the position and the
  // peak match, so it is the main smoothness-vs-response control.
  binSmoothing: 0.25,
  // Velocity gain of the same tracker. 0 = derive it from binSmoothing. Raising
  // it tracks a hand that is speeding up or changing direction sooner, at the
  // cost of letting more peak noise through into the position.
  posBeta: 0.15,
  // Extra margin (in bins) the centroid must clear before the bin changes, so
  // a position sitting near a .5 boundary cannot flip back and forth.
  binHysteresis: 0.2,
  // How far a tracked hand may jump to the nearest peak before it is re-locked.
  // Sized against the tracker's residual lag: too tight and a hand that is
  // speeding up is stranded mid-move and has to be re-acquired.
  matchRadiusBins: 6,
  // How far a pending second hand may drift between frames without losing its
  // progress toward lockFrames. Wider than the match radius: a candidate is not
  // yet tracked, so its peak flickers across bins as the hands move.
  candidateRadiusBins: 2,
  // Bins of extra drift the candidate may cover per frame it has already
  // persisted. Lets a steadily moving hand accumulate its lock frames instead of
  // having the count reset by its own motion.
  candidateDriftBins: 1,
  // Frames a hand may be unmatched before it is declared lost. Long enough to
  // ride out a brief dropout without resetting the hand's displacement.
  holdFrames: 25,
  // Single-hand mode needs a much shorter hold. Its range is absolute, so there
  // is nothing to preserve, and a held hand blocks re-acquisition for the whole
  // window: on the recordings this is the difference between a 1.25 s freeze
  // and a 0.3 s one when the hand's peak drops below the detection bar.
  singleHoldFrames: 6,
  // Frames a candidate peak must persist before it is locked as a new hand.
  // Long enough to reject transient interference peaks.
  lockFrames: 4,
  // EMA time constant (s) for the "wheel centered" zero baseline. Long enough
  // that a held turn sticks, short enough to absorb slow posture drift.
  baselineSeconds: 20,
  // Freeze the centering baseline instead of letting it chase the hands, so a
  // held turn keeps its angle until Recenter is pressed. Off = rolling baseline.
  baselineHold: false,
  // After both hands are lost, hold the last angle this long before blanking.
  blankSeconds: 1.5,
  // Degrees of wheel rotation per mm of differential radial hand motion. The
  // real differential is tens of mm, so keep this well below 1:1 with degrees.
  angleGainDegPerMm: 1,
  // Output smoothing: EMA time constant (s) plus a slew-rate cap (deg/s) so the
  // wheel glides instead of jumping on per-frame phase noise.
  smoothingSeconds: 0.08,
  maxSlewDegPerSec: 2000,
  // Flip the sign if "clockwise" comes out negative for a given mount. The
  // radar only sees near/far, so the sign depends on which side it sits.
  invertDirection: false,
};

// Driving game. The car holds station and the world scrolls past it; the wheel
// angle sets the car's heading, and the heading carries it sideways.
export const GAME = {
  // World speed in CSS pixels per second, i.e. how fast the road scrolls.
  speed: 300,
  // Degrees of car heading per degree of wheel angle. The wheel only reaches a
  // few tens of degrees in normal driving, so this needs to be well above 1 for
  // a small turn to visibly move the car.
  headingScale: 0.45,
  // Hard cap on the heading, so full lock cannot spin the car broadside.
  maxHeadingDeg: 40,
  // Time constant (s) for the car's heading to follow the wheel.
  headingTau: 0.14,
  // Road width as a fraction of the view, capped in pixels.
  roadFraction: 0.6,
};

// Virtual Xbox pad bridge. The page opens one local WebSocket to a Windows
// helper that owns a ViGEmBus pad, so the radar can drive any game that reads
// an ordinary controller. Left stick X only: everything else stays keyboard.
export const PAD = {
  // Loopback by default, so it works whether the page is served by WSL or by
  // Windows python; only the browser's machine matters.
  url: 'ws://127.0.0.1:8765',
  // Wheel angle that reaches full stick lock.
  maxAngleDeg: 90,
  // Stick travel ignored around centre, so per-frame jitter does not steer.
  deadzone: 0.06,
  // Expo: above 1 gives finer control near centre; 1 is linear.
  curve: 1.35,
  // Smallest stick change worth a packet.
  epsilon: 0.004,
  // Send rate cap (50 Hz). The DSP frame rate is usually lower anyway.
  intervalMs: 20,
  // Reconnect backoff while the bridge is not running.
  minRetryMs: 250,
  maxRetryMs: 2000,
};

// Explanatory text for the settings help popovers.
export const HELP = {
  startPoint: {
    title: 'Start point',
    text: 'Distance of the first measured bin, in discrete steps of ~2.5 mm. Shifts the whole range window. May be negative (down to -275) to begin before the antenna plane.',
    recommended: '100 (≈0.25 m) for hands on a wheel',
  },
  numPoints: {
    title: 'Number of points',
    text: 'How many bins are measured across the window. The window must cover the whole steering arc, so the hands stay inside it at every turn angle. Window length = (num_points - 1) × step_length.',
    recommended: '40 (≈0.8 m window)',
  },
  stepLength: {
    title: 'Step length',
    text: 'Spacing between bins, in ~2.5 mm units (e.g. 8 = 20 mm). Must divide or be a multiple of 24. Small enough steps let the two hands fall in separate bins, which the differential angle needs.',
    recommended: '8 (20 mm)',
  },
  profile: {
    title: 'Profile (1–5)',
    text: 'Pulse length. Lower profiles give better range resolution and can measure closer (smaller close-in distance) but have less gain; higher profiles give more SNR at the cost of resolution and a larger close-in distance.',
    recommended: '3 (use 4–5 if the hands are far)',
  },
  hwaas: {
    title: 'HWAAS',
    text: 'Hardware Accelerated Average Samples: each point is averaged this many times by the sensor. Higher values raise SNR but increase measurement time linearly, lowering the achievable frame rate.',
    recommended: '32–64',
  },
  receiverGain: {
    title: 'Receiver gain (0–23)',
    text: 'Front-end gain. Too low causes quantization; too high saturates the signal and corrupts the phase (which carries the steering motion).',
    recommended: '16',
  },
  updateRate: {
    title: 'Update rate',
    text: 'Frame-rate limiter, which sets the phase sampling rate (fs). A wheel turn is a slow (<2 Hz) motion, so 20 Hz gives plenty of margin while keeping serial traffic low.',
    recommended: '20 Hz',
  },
};

// Friendly names for common USB-serial bridges and Acconeer native USB IDs.
// The SparkFun XM125 uses a USB-serial bridge (e.g. CH340 / CP210x); the exact
// ID depends on the board revision.
export const USB_BRIDGES = {
  '0483:a41d': 'Acconeer XC120',
  '0483:a42c': 'Acconeer XC120',
  '0483:a42d': 'Acconeer XC120',
  '0483:a449': 'Acconeer XC120',
  'acc0:e121': 'Acconeer XV12X',
  '10c4:ea60': 'Silicon Labs CP210x',
  '10c4:ea70': 'Silicon Labs CP2105',
  '1a86:7523': 'WCH CH340',
  '1a86:55d4': 'WCH CH9102',
  '0403:6001': 'FTDI FT232',
  '0403:6015': 'FTDI FT231X',
  '2341:0043': 'Arduino',
};

export function describePortInfo(info) {
  if (!info || info.usbVendorId == null || info.usbProductId == null) {
    return 'unknown device';
  }
  const vid = info.usbVendorId.toString(16).padStart(4, '0');
  const pid = info.usbProductId.toString(16).padStart(4, '0');
  const key = `${vid}:${pid}`;
  const name = USB_BRIDGES[key];
  return name ? `${name} (${key})` : `USB device (${key})`;
}
