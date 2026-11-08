globalThis.ResizeObserver = class {
  constructor() {}
  observe() {}
};
globalThis.window = { devicePixelRatio: 1 };

const noop = () => {};
const segments = [];
let pending = null;
const ctx = {
  clearRect: noop,
  setTransform: noop,
  save: noop,
  restore: noop,
  translate: noop,
  rotate: noop,
  beginPath: noop,
  arc: noop,
  stroke: noop,
  fill: noop,
  moveTo: (x, y) => {
    pending = [x, y];
  },
  lineTo: (x, y) => {
    if (pending) segments.push([pending, [x, y]]);
    pending = null;
  },
};
const canvas = {
  getContext: () => ctx,
  parentElement: null,
  style: {},
  clientHeight: 240,
  width: 0,
  height: 0,
  getBoundingClientRect: () => ({ width: 260, height: 240 }),
};

const { SteeringWheel } = await import('../source/js/wheel.js');

let ok = true;
try {
  const wheel = new SteeringWheel(canvas);
  wheel.setAngle(45, { blanked: false, mode: 'differential' });
  wheel.setAngle(-90, { blanked: true, mode: 'none' });

  segments.length = 0;
  wheel.setAngle(0);

  // Spokes are the segments that start at the hub (0, 0).
  const spokes = segments
    .filter(([from]) => Math.abs(from[0]) < 1e-9 && Math.abs(from[1]) < 1e-9)
    .map(([, to]) => to);
  const has = (pred) => spokes.some(pred);
  const left = has(([x, y]) => x < -1 && Math.abs(y) < 1);
  const right = has(([x, y]) => x > 1 && Math.abs(y) < 1);
  const down = has(([x, y]) => y > 1 && Math.abs(x) < 1);
  const up = has(([x, y]) => y < -1 && Math.abs(x) < 1);
  const spokeCount = spokes.length === 3;
  ok = left && right && down && !up && spokeCount;
  if (!ok) {
    console.log(`spokes=${JSON.stringify(spokes)} left=${left} right=${right} down=${down} up=${up} count3=${spokeCount}`);
  }
} catch (err) {
  ok = false;
  console.log('error:', err.message);
}
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
