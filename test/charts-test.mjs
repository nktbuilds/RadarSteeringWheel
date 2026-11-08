globalThis.ResizeObserver = class {
  constructor() {}
  observe() {}
};
globalThis.window = { devicePixelRatio: 1 };
const ctx = new Proxy(
  {},
  { get: (t, p) => (p in t ? t[p] : () => {}), set: (t, p, v) => ((t[p] = v), true) },
);
const canvas = {
  getContext: () => ctx,
  parentElement: null,
  style: {},
  clientHeight: 190,
  width: 0,
  height: 0,
  getBoundingClientRect: () => ({ width: 400, height: 190 }),
};

const { BarChart, LineChart } = await import('../source/js/charts.js');
let ok = true;
try {
  const b = new BarChart(canvas);
  b.setData([1, 2, 3, 4]);
  b.setData([1, 2, 3, 4], { stepMeters: 0.02, startMeters: 0.25 });
  const ticks = b._tickBins(40);
  ok = ticks.length >= 2 && ticks[0] === 0 && ticks[ticks.length - 1] === 39;
  if (!ok) console.log('tick bins:', ticks);
  const l = new LineChart(canvas);
  l.setData([1, 2, 3, 4]);
  l.setData([], {});
} catch (err) {
  ok = false;
  console.log('error:', err.message);
}
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
