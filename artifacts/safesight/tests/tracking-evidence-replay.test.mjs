import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRiskAssessor } from '../src/lib/risk.ts';
import { createPersonTracker } from '../src/lib/person-tracking.ts';
import { peopleFrame, person } from './fixtures/people.mjs';

const named = (name, x, options = {}) => ({ truth: name, ...person(x, { ...options, id: `ignored-${name}` }) });
const sequences = {
  crossing: [
    [named('A', .2, { angle: 90 }), named('B', .8)],
    [named('A', .32, { angle: 90 }), named('B', .68)],
    [named('A', .45, { angle: 90 }), named('B', .55)],
    [named('A', .7, { angle: 90 }), named('B', .3)],
  ],
  loss: [[named('A', .3, { angle: 90 })], [], [named('A', .3, { angle: 90 })]],
  replacement: [[named('A', .3, { angle: 90 })], [], [named('B', .3, { angle: 90 })]],
  entryExit: [[named('A', .2)], [named('A', .2), named('B', .8)], [named('B', .8)], []],
  crowded: [
    [named('A', .1), named('B', .4), named('C', .8)],
    [named('A', .2), named('B', .3), named('C', .8)],
    [named('B', .1), named('A', .5), named('C', .8)],
  ],
};

function replay(sequence) {
  const tracker = createPersonTracker(), owners = new Map();
  let falseContinuity = 0, carryover = 0, usable = 0, unknown = 0;
  const frames = sequence.map((truth, index) => {
    const r = tracker.update(peopleFrame(truth), 1000, 600, index * 1000);
    truth.forEach((t, i) => {
      const p = r.persons[i];
      if (!p.id) { unknown++; return; }
      if (owners.has(p.id) && owners.get(p.id) !== t.truth) {
        falseContinuity++;
        if (p.horizontalMs || p.observations.length) carryover++;
      }
      owners.set(p.id, t.truth);
      if (p.status === 'tracked' && p.posture !== 'unavailable') usable++;
    });
    return r;
  });
  return { frames, falseContinuity, carryover, usable, unknown };
}
for (const [name, sequence] of Object.entries(sequences)) test(`known-identity ${name} replay reports no false continuity or carried timer`, () => {
  const r = replay(sequence);
  const expected = { crossing: [2, 2], loss: [0, 0], replacement: [0, 0], entryExit: [2, 0], crowded: [2, 2] };
  assert.equal(r.falseContinuity, 0);
  assert.equal(r.carryover, 0);
  assert.equal(r.usable, expected[name][0], 'usable sample count matches the committed fixture table');
  assert.equal(r.unknown, expected[name][1], 'unassigned sample count matches the committed fixture table');
  assert.ok(r.frames.length === sequence.length);
  if (name === 'crossing' || name === 'crowded') assert.ok(r.unknown > 0);
});
test('identity metric exposes an unobservable between-sample replacement instead of claiming perfect tracking', () => {
  // These images have identical spatial evidence but different scripted physical
  // truth. No anonymous image tracker can identify that substitution from pixels.
  const r = replay([[named('A', .3, { angle: 90 })], [named('A', .3, { angle: 90 })], [named('B', .3, { angle: 90 })]]);
  assert.equal(r.falseContinuity, 1);
  assert.equal(r.carryover, 1);
  assert.equal(r.usable, 2);
});
test('missing torso, gaps, aspect changes and source changes cannot carry a posture timer', () => {
  for (const interruption of ['torso', 'gap', 'aspect', 'source']) {
    const engine = createRiskAssessor();
    const f = (time, noPose = []) => peopleFrame([person(.3, { angle: 90 })], { time, noPose });
    engine.assess(f(0), 1000, 600, 0, { source: 'live' });
    engine.assess(f(1000), 1000, 600, 1000, { source: 'live' });
    const r = interruption === 'torso' ?
      engine.assess(f(2000, [0]), 1000, 600, 2000, { source: 'live' }) :
      interruption === 'gap' ? engine.assess(f(4000), 1000, 600, 4000, { source: 'live' }) :
      interruption === 'aspect' ? engine.assess(f(2000), 600, 1000, 2000, { source: 'live' }) :
      engine.assess(f(2000), 1000, 600, 2000, { source: 'demo' });
    assert.equal(r.score, 0);
    assert.ok(r.tracking.persons.every(p => !p.horizontalMs && !p.observations.length));
  }
});
