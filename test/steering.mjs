import { SteeringProcessor } from '../source/js/dsp/steering.js';
import { WAVELENGTH_M } from '../source/js/config.js';

const N = 40;
const NEAR_BIN = 12;
const FAR_BIN = 24;
const MM_PER_RAD = (WAVELENGTH_M / (4 * Math.PI)) * 1000;

function frame(nearMm, farMm, { nearAmp = 8000, farAmp = 7000 } = {}) {
  const amplitudes = new Array(N).fill(0);
  const phases = new Array(N).fill(0);
  const put = (baseBin, mm, amp) => {
    const pos = baseBin + mm / 20;
    for (let b = 0; b < N; b++) {
      const d = b - pos;
      amplitudes[b] += amp * Math.exp(-(d * d) / 0.72);
    }
  };
  put(NEAR_BIN, nearMm, nearAmp);
  put(FAR_BIN, farMm, farAmp);
  phases[NEAR_BIN] = nearMm / MM_PER_RAD;
  phases[FAR_BIN] = farMm / MM_PER_RAD;
  return { amplitudes, phases };
}

function run(proc, frames) {
  let last = null;
  for (const f of frames) last = proc.process(f);
  return last;
}

function singleFrame(bin, mm = 0) {
  const amplitudes = new Array(N).fill(0);
  const phases = new Array(N).fill(0);
  amplitudes[bin] = 8000;
  phases[bin] = mm / MM_PER_RAD;
  return { amplitudes, phases };
}

const results = [];

// 1. Two hands lock, and a settled wheel reads ~centered.
{
  const p = new SteeringProcessor();
  const frames = [];
  for (let i = 0; i < 40; i++) frames.push(frame(0, 0));
  const r = run(p, frames);
  const ok = r.mode === 'differential' && !r.blanked && Math.abs(r.angleDeg) < 5;
  results.push(['lock + centered', ok, r]);
}

// 2. Turning one way drives the angle one way.
{
  const p = new SteeringProcessor();
  const frames = [];
  for (let i = 0; i < 40; i++) frames.push(frame(0, 0));
  for (let i = 1; i <= 60; i++) frames.push(frame(-0.15 * i, 0.15 * i));
  const r = run(p, frames);
  const ok = !r.blanked && r.angleDeg > 10;
  results.push(['turn right -> positive angle', ok, r]);
}

// 3. Turning the other way drives the angle the other way.
{
  const p = new SteeringProcessor();
  const frames = [];
  for (let i = 0; i < 40; i++) frames.push(frame(0, 0));
  for (let i = 1; i <= 60; i++) frames.push(frame(0.15 * i, -0.15 * i));
  const r = run(p, frames);
  const ok = !r.blanked && r.angleDeg < -10;
  results.push(['turn left -> negative angle', ok, r]);
}

// 4. A single visible hand falls back to single-hand mode.
{
  const p = new SteeringProcessor();
  const frames = [];
  for (let i = 0; i < 40; i++) frames.push(frame(0, 0, { farAmp: 0 }));
  const r = run(p, frames);
  const ok = r.mode === 'single' && !r.blanked;
  results.push(['single hand mode', ok, r]);
}

// 5. Losing the hands blanks the readout after the hold window.
{
  const p = new SteeringProcessor();
  const frames = [];
  for (let i = 0; i < 40; i++) frames.push(frame(0, 0));
  for (let i = 0; i < 70; i++) frames.push(frame(0, 0, { nearAmp: 0, farAmp: 0 }));
  const r = run(p, frames);
  const ok = r.blanked === true && r.mode === 'none';
  results.push(['hand loss blanks', ok, r]);
}

// 6. A held turn keeps its angle instead of decaying back to center.
{
  const p = new SteeringProcessor();
  const frames = [];
  for (let i = 0; i < 40; i++) frames.push(frame(0, 0));
  for (let i = 1; i <= 60; i++) frames.push(frame(-0.15 * i, 0.15 * i));
  for (let i = 0; i < 100; i++) frames.push(frame(-9, 9));
  const r = run(p, frames);
  const ok = !r.blanked && r.angleDeg > 5;
  results.push(['held turn sticks', ok, r]);
}

// 7. Live tuning: invert flips the sign, gain scales the output.
{
  const p = new SteeringProcessor();
  p.setConfig({ invertDirection: true });
  const frames = [];
  for (let i = 0; i < 40; i++) frames.push(frame(0, 0));
  for (let i = 1; i <= 60; i++) frames.push(frame(-0.15 * i, 0.15 * i));
  const r = run(p, frames);
  const ok = !r.blanked && r.angleDeg < -10;
  results.push(['invert flips direction', ok, r]);
}

{
  const p = new SteeringProcessor();
  p.setConfig({ angleGainDegPerMm: 2 });
  const frames = [];
  for (let i = 0; i < 40; i++) frames.push(frame(0, 0));
  for (let i = 1; i <= 60; i++) frames.push(frame(-0.15 * i, 0.15 * i));
  const r = run(p, frames);
  const ok = !r.blanked && r.angleDeg > 25;
  results.push(['live gain scales output', ok, r]);
}

// 9. A hand that crosses into another range bin accumulates the bin step as
//    real distance, not just the sub-bin phase.
{
  const p = new SteeringProcessor({ stepM: 0.02 });
  const frames = [];
  for (let i = 0; i < 20; i++) frames.push(singleFrame(12, 0));
  for (let i = 0; i < 20; i++) frames.push(singleFrame(14, 0));
  const r = run(p, frames);
  const near = r.hands.near;
  const ok = !!near && Math.abs(near.dispMm - 40) < 6;
  results.push(['bin hop adds distance', ok, r]);
}

// 10. A peak flickering between adjacent bins must not inject bin steps.
{
  const p = new SteeringProcessor({ stepM: 0.02 });
  const frames = [];
  for (let i = 0; i < 20; i++) frames.push(singleFrame(12, 0));
  for (let i = 0; i < 100; i++) frames.push(singleFrame(i % 7 === 0 ? 13 : 12, 0));
  const r = run(p, frames);
  const near = r.hands.near;
  const ok = !!near && Math.abs(near.dispMm) < 5;
  results.push(['bin flicker rejected', ok, r]);
}

// 11. A hand dropping out must re-zero the turn signal, not step it.
{
  const p = new SteeringProcessor();
  const frames = [];
  for (let i = 0; i < 40; i++) frames.push(frame(0, 0));
  for (let i = 1; i <= 60; i++) frames.push(frame(-0.15 * i, 0.15 * i));
  for (let i = 0; i < 60; i++) frames.push(frame(-9, 9, { farAmp: 0 }));
  const r = run(p, frames);
  const ok = r.mode === 'single' && Math.abs(r.turnMm) < 3;
  results.push(['hand drop re-zeroes', ok, r]);
}

// 12. A transient interference peak must not claim a second hand.
{
  const p = new SteeringProcessor();
  const frames = [];
  for (let i = 0; i < 80; i++) {
    const f = singleFrame(12, 0);
    if (i % 8 === 3) f.amplitudes[30] = 6000;
    frames.push(f);
  }
  const r = run(p, frames);
  const ok = r.mode === 'single';
  results.push(['transient peak rejected', ok, r]);
}

// 13. Hold (absolute) mode keeps a sustained turn; the rolling baseline decays.
{
  const mk = () => {
    const frames = [];
    for (let i = 0; i < 40; i++) frames.push(frame(0, 0));
    for (let i = 1; i <= 60; i++) frames.push(frame(-0.15 * i, 0.15 * i));
    for (let i = 0; i < 600; i++) frames.push(frame(-9, 9));
    return frames;
  };
  const rolling = new SteeringProcessor();
  const hold = new SteeringProcessor();
  hold.setConfig({ baselineHold: true });
  const a = run(rolling, mk());
  const b = run(hold, mk());
  const ok = b.angleDeg > 15 && b.angleDeg > a.angleDeg * 2;
  results.push(['hold mode keeps turn', ok, b]);
}

// 14. A weak far hand just above the floor, drifting a couple of bins, must
//     still lock. Before the floor was lowered this stayed in single mode.
{
  const p = new SteeringProcessor();
  const frames = [];
  for (let i = 0; i < 30; i++) {
    const amplitudes = new Array(N).fill(40);
    const phases = new Array(N).fill(0);
    const farBin = 13 + (i % 3 === 0 ? 2 : 0);
    amplitudes[4] = 360;
    amplitudes[5] = 240;
    amplitudes[8] = 75;
    amplitudes[farBin - 1] = 135;
    amplitudes[farBin] = 175;
    amplitudes[farBin + 1] = 125;
    frames.push({ amplitudes, phases });
  }
  const r = run(p, frames);
  const ok = r.mode === 'differential' && !r.blanked;
  results.push(['weak far hand locks', ok, r]);
}

// 15. A broad single-hand blob with a shallow saddle must not be split into two
//     fake hands by the lower threshold.
{
  const p = new SteeringProcessor();
  const frames = [];
  for (let i = 0; i < 40; i++) {
    const amplitudes = new Array(N).fill(30);
    const phases = new Array(N).fill(0);
    amplitudes[10] = 520;
    amplitudes[11] = 800;
    amplitudes[12] = 620;
    amplitudes[13] = 580;
    amplitudes[14] = 650;
    amplitudes[15] = 430;
    frames.push({ amplitudes, phases });
  }
  const r = run(p, frames);
  const ok = r.mode === 'single';
  results.push(['merged blob not split', ok, r]);
}

// 16. Single-hand driving tracks one peak and ignores the second hand.
{
  const p = new SteeringProcessor({ singleHandMode: true });
  const frames = [];
  for (let i = 0; i < 40; i++) frames.push(frame(0, 0));
  const r = run(p, frames);
  const ok = r.mode === 'single' && r.hands.far === null && r.hands.near !== null && !r.blanked;
  results.push(['single-hand mode ignores second hand', ok, r]);
}

// 17. Single-hand driving maps one hand's radial distance to the wheel angle.
{
  const p = new SteeringProcessor({ singleHandMode: true, baselineHold: true });
  const frames = [];
  for (let i = 0; i < 40; i++) frames.push(frame(0, 0));
  for (let i = 1; i <= 80; i++) frames.push(frame(0.2 * i, 0));
  const r = run(p, frames);
  const ok = r.mode === 'single' && r.angleDeg > 8;
  results.push(['single-hand radial distance -> angle', ok, r]);
}

// 18. Toggling single-hand mode live drops the second hand instead of leaving a
//     stale lock behind.
{
  const p = new SteeringProcessor();
  const frames = [];
  for (let i = 0; i < 40; i++) frames.push(frame(0, 0));
  const before = run(p, frames);
  p.setConfig({ singleHandMode: true });
  const after = run(p, frames);
  const ok = before.mode === 'differential' && after.mode === 'single' && after.hands.far === null;
  results.push(['single-hand toggle drops second hand', ok, after]);
}

const gaussFrame = (rangeMm, amp = 8000) => {
  const amplitudes = new Array(N).fill(0);
  const phases = new Array(N).fill(0);
  for (let b = 0; b < N; b++) {
    const d = b * 20 - rangeMm;
    amplitudes[b] = amp * Math.exp(-(d * d) / (2 * 12 * 12));
  }
  return { amplitudes, phases };
};

// 19. Centroid position tracks a hand moving inside a single range bin
//     continuously, instead of waiting for a 20 mm bin step.
{
  const p = new SteeringProcessor({ singleHandMode: true, baselineHold: true, stepM: 0.02 });
  for (let i = 0; i < 20; i++) p.process(gaussFrame(400));
  const turns = [];
  let r = null;
  for (let i = 1; i <= 10; i++) {
    r = p.process(gaussFrame(400 + i));
    turns.push(r.turnMm);
  }
  const steps = turns.slice(1).map((v, i) => v - turns[i]);
  const moved = steps.filter((s) => s > 0.1).length;
  const ok = turns[turns.length - 1] > 4 && moved >= 7;
  results.push(['centroid tracks inside one bin', ok, r]);
}

// 20. With the centroid source off, sub-bin motion carries no phase signal, so
//     the readout is quantised away until the hand crosses a whole bin.
{
  const p = new SteeringProcessor({
    singleHandMode: true,
    baselineHold: true,
    stepM: 0.02,
    centroidPosition: false,
  });
  for (let i = 0; i < 20; i++) p.process(gaussFrame(400));
  const turns = [];
  let r = null;
  for (let i = 1; i <= 10; i++) {
    r = p.process(gaussFrame(400 + i));
    turns.push(r.turnMm);
  }
  const steps = turns.slice(1).map((v, i) => v - turns[i]);
  const moved = steps.filter((s) => Math.abs(s) > 0.1).length;
  const ok = Math.abs(turns[turns.length - 1]) < 1 && moved <= 1;
  results.push(['bin source quantises sub-bin motion', ok, r]);
}

// 21. Single-hand driving is a plain distance -> angle map: recentre at a
//     distance, closer turns one way, further the other, and losing the hand
//     must not silently move the centre.
{
  const hold = (p, rangeMm, n = 20) => {
    let r = null;
    for (let i = 0; i < n; i++) r = p.process(gaussFrame(rangeMm));
    return r;
  };
  const p = new SteeringProcessor({ singleHandMode: true, baselineHold: true, stepM: 0.02 });
  for (let i = 0; i < 30; i++) p.process(gaussFrame(480));
  p.recenter();
  p.process(gaussFrame(480));
  const closer = hold(p, 440);
  const further = hold(p, 520);
  for (let i = 0; i < 60; i++) p.process(gaussFrame(480, 0));
  const back = hold(p, 440);
  const ok = closer.turnMm < -10 && further.turnMm > 10 && back.turnMm < -10;
  results.push(['single-hand distance map survives dropout', ok, back]);
}

let allOk = true;
for (const [name, ok, r] of results) {
  if (!ok) allOk = false;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} — mode=${r.mode} angle=${r.angleDeg.toFixed(1)} blanked=${r.blanked}`);
}
console.log(allOk ? 'PASS' : 'FAIL');
process.exit(allOk ? 0 : 1);
