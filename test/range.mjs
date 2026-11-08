import { computeRangeWindow, HANDS_PRESET, HELP, isValidStepLength } from '../source/js/config.js';

const win = computeRangeWindow(HANDS_PRESET);
console.log('hands preset window:', win);

const nearOk = Math.abs(win.nearM - 0.25) < 0.01;
const farOk = Math.abs(win.farM - 1.03) < 0.03;
const spacingOk = Math.abs(win.spacingM - 0.02) < 0.001;
const stepOk = isValidStepLength(8) && !isValidStepLength(5);
const helpOk = ['startPoint', 'numPoints', 'stepLength', 'profile', 'hwaas', 'receiverGain', 'updateRate']
  .every((k) => HELP[k] && HELP[k].title && HELP[k].text);

console.log('near/far/spacing/step/help:', nearOk, farOk, spacingOk, stepOk, helpOk);
const ok = nearOk && farOk && spacingOk && stepOk && helpOk;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
