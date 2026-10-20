import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinMotion, fadeStep, WALK, SAIL, FADE } from '../src/pin-motion-model.mjs';

const close = (a, b) => Math.abs(a - b) < 1e-9;

test('pin motion: still at the start, and nothing for a bad time', () => {
  for (const kind of ['land', 'dinghy', 'galleon']) assert.ok(close(pinMotion(kind, 0).dy, 0) && close(pinMotion(kind, 0).rot, 0));
  assert.deepEqual(pinMotion('land', NaN), { dy: 0, rot: 0 });
  assert.deepEqual(pinMotion('brig', -1), { dy: 0, rot: 0 });
});

test('pin motion: the traveller hops each stride and never sinks below the hex', () => {
  const mid = pinMotion('land', WALK.stride / 2);
  assert.ok(close(mid.dy, -WALK.hop));
  assert.ok(close(pinMotion('land', WALK.stride).dy, 0));
  for (let t = 0; t < 3; t += 0.05) {
    const m = pinMotion('land', t);
    assert.ok(m.dy <= 0 && m.dy >= -WALK.hop);
    assert.ok(Math.abs(m.rot) <= WALK.sway + 1e-12);
  }
  // One step sways one way, the next the other.
  assert.ok(pinMotion('land', WALK.stride * 0.5).rot > 0 && pinMotion('land', WALK.stride * 1.5).rot < 0);
});

test('pin motion: a small boat rolls quicker and further than a big ship', () => {
  const boat = pinMotion('dinghy', SAIL.small.period / 4);
  const ship = pinMotion('galleon', SAIL.big.period / 4);
  assert.ok(close(boat.rot, SAIL.small.roll) && close(ship.rot, SAIL.big.roll));
  assert.ok(boat.rot > ship.rot);
  assert.ok(SAIL.small.period < SAIL.big.period);
  assert.deepEqual(pinMotion('brig', 1.234), pinMotion('galleon', 1.234));
  assert.deepEqual(pinMotion('longboat', 1.234), pinMotion('dinghy', 1.234));
  for (let t = 0; t < 8; t += 0.1) assert.ok(pinMotion('longboat', t).dy <= 0);
});

test('pin motion: fades in and out over its time', () => {
  assert.equal(fadeStep(0, true, FADE / 2), 0.5);
  assert.equal(fadeStep(0.5, true, FADE), 1);
  assert.equal(fadeStep(1, false, FADE / 4), 0.75);
  assert.equal(fadeStep(0.1, false, FADE), 0);
  assert.equal(fadeStep(undefined, true, 0), 0);
  assert.equal(fadeStep(0.3, true, -1), 0.3);
});
