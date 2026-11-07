#!/usr/bin/env node
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeInterval, overlaps, contains, assertBounds, assertAlignment,
  guestToLinear, validateCandidate
} from './memory-intervals.mjs';

const g = (start, end) => makeInterval('guest', start, end);
const l = (start, end) => makeInterval('linear', start, end);
const reservation = (owner, interval) => ({owner, interval});
const setup = (overrides = {}) => ({
  owner: 'requested-region',
  candidate: g(100, 200), guestBase: 1000, guestLimit: 2000,
  memoryByteLength: 4000,
  guestReservations: [reservation('requested-region', g(64, 256))],
  linearReservations: [reservation('requested-region', l(1064, 1256))],
  occupiedGuest: [], occupiedLinear: [],
  ...overrides
});
const rejects = (fn, pattern) => assert.throws(fn, pattern);

test('nonempty half-open intervals and adjacent boundaries', () => {
  assert.equal(overlaps(g(10, 20), g(20, 30)), false);
  assert.equal(overlaps(g(10, 20), g(19, 30)), true);
  assert.equal(overlaps(g(20, 30), g(10, 20)), false);
});
test('containment includes equal endpoints but not partial coverage', () => {
  assert.equal(contains(g(10, 20), g(10, 20)), true);
  assert.equal(contains(g(10, 20), g(12, 19)), true);
  assert.equal(contains(g(10, 20), g(12, 21)), false);
});
test('guest and linear comparison is prohibited even with matching numeric offsets', () => {
  rejects(() => overlaps(g(1, 5), l(1, 5)), /Cannot compare/);
  rejects(() => contains(l(1, 5), g(1, 5)), /Cannot compare/);
});
test('invalid address space is rejected', () => {
  rejects(() => makeInterval('wasm', 1, 2), /space/);
});
test('non-safe, fractional, negative, and non-number endpoints are rejected', () => {
  for (const bad of [-1, 1.2, NaN, Infinity, 2 ** 53, '1', 1n]) {
    rejects(() => makeInterval('guest', bad, 20), /safe integer/);
    rejects(() => makeInterval('linear', 0, bad), /safe integer/);
  }
});
test('zero-length and reversed intervals are rejected', () => {
  rejects(() => g(10, 10), /nonempty/);
  rejects(() => g(11, 10), /nonempty/);
});
test('bounds are exclusive and allow end equal to limit', () => {
  assert.equal(assertBounds(g(0, 256), 256), true);
  rejects(() => assertBounds(g(0, 257), 256), /exceeds/);
});
test('limit must be a safe nonnegative integer', () => {
  for (const bad of [-1, 3.5, 2 ** 53]) rejects(() => assertBounds(g(0, 1), bad), /safe integer/);
});
test('alignment applies to start only unless end alignment is requested', () => {
  assert.equal(assertAlignment(g(32, 47), {start: 16}), true);
  rejects(() => assertAlignment(g(31, 47), {start: 16}), /start/);
  rejects(() => assertAlignment(g(32, 47), {start: 16, end: 8}), /end/);
  assert.equal(assertAlignment(g(12, 27), {start: 3, end: 9}), true);
});
test('alignment parameters must be positive safe integers', () => {
  for (const bad of [0, -1, 2.5, 2 ** 53]) rejects(() => assertAlignment(g(1, 3), {start: bad}), /positive safe integer/);
});
test('guest-to-linear conversion uses offset and does not modify guest addresses', () => {
  assert.deepEqual(guestToLinear(g(100, 200), 1000), l(1100, 1200));
  assert.deepEqual(g(100, 200), {space: 'guest', start: 100, end: 200});
});
test('guest-to-linear conversion requires a guest interval and safe base', () => {
  rejects(() => guestToLinear(l(100, 200), 1000), /Expected guest/);
  for (const bad of [-1, NaN, 1.5, 2 ** 53]) rejects(() => guestToLinear(g(1, 2), bad), /guestBase/);
});
test('guest-to-linear sum overflow is rejected without wrapping', () => {
  rejects(() => guestToLinear(g(1, 3), Number.MAX_SAFE_INTEGER - 1), /safe integer range/);
});
test('explicit matching guest and linear reservations admit valid candidate', () => {
  assert.deepEqual(validateCandidate(setup()), {
    owner: 'requested-region', guest: g(100, 200), linear: l(1100, 1200)
  });
});
test('result and returned intervals are frozen', () => {
  const result = validateCandidate(setup());
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.guest));
  assert.ok(Object.isFrozen(result.linear));
});
test('no reservations: valid bounds cannot establish ownership', () => {
  rejects(() => validateCandidate(setup({guestReservations: [], linearReservations: []})), /owned guest reservation/);
});
test('zero-filled backing memory cannot establish ownership', () => {
  const memory = new Uint8Array(4000);
  assert.equal(memory.every(b => b === 0), true);
  rejects(() => validateCandidate(setup({memoryByteLength: memory.length, guestReservations: []})), /owned guest reservation/);
});
test('linear-only malloc-style allocation does not reserve guest addresses', () => {
  rejects(() => validateCandidate(setup({guestReservations: []})), /owned guest reservation/);
});
test('guest-only reservation does not prove backing ownership', () => {
  rejects(() => validateCandidate(setup({linearReservations: []})), /owned linear reservation/);
});
test('a same-owner guest reservation must cover the entire candidate', () => {
  rejects(() => validateCandidate(setup({guestReservations: [reservation('requested-region', g(100, 199))]})), /owned guest reservation/);
});
test('a same-owner linear reservation must cover the entire backing range', () => {
  rejects(() => validateCandidate(setup({linearReservations: [reservation('requested-region', l(1100, 1199))]})), /owned linear reservation/);
});
test('wrong owner never authorizes a candidate', () => {
  rejects(() => validateCandidate(setup({owner: 'stranger'})), /owned guest reservation/);
});
test('explicit guest occupied overlap rejects but adjacency succeeds', () => {
  rejects(() => validateCandidate(setup({occupiedGuest: [g(199, 220)]})), /guest memory/);
  assert.deepEqual(validateCandidate(setup({occupiedGuest: [g(200, 220)]})).linear, l(1100, 1200));
});
test('explicit linear occupied overlap rejects even though guest is unoccupied', () => {
  rejects(() => validateCandidate(setup({occupiedLinear: [l(1199, 1400)]})), /linear memory/);
});
test('explicit linear occupied region ending at candidate start is adjacent', () => {
  assert.deepEqual(validateCandidate(setup({occupiedLinear: [l(1000, 1100)]})).linear, l(1100, 1200));
});
test('other owners guest reservation overlapping candidate rejects', () => {
  rejects(() => validateCandidate(setup({guestReservations: [
    reservation('requested-region', g(64, 256)), reservation('different-owner', g(150, 180))
  ]})), /guest memory/);
});
test('other owners linear reservation overlapping backing rejects', () => {
  rejects(() => validateCandidate(setup({linearReservations: [
    reservation('requested-region', l(1064, 1256)), reservation('different-owner', l(1100, 1101))
  ]})), /linear memory/);
});
test('guest exclusive bound is enforced independently', () => {
  rejects(() => validateCandidate(setup({guestLimit: 199})), /guest interval exceeds/);
});
test('backing exclusive bound is enforced independently', () => {
  rejects(() => validateCandidate(setup({memoryByteLength: 1199})), /linear interval exceeds/);
});
test('candidate linear mapping can be in bounds yet outside owned linear memory', () => {
  rejects(() => validateCandidate(setup({guestBase: 1300})), /owned linear reservation/);
});
test('caller-provided guest alignment is enforced without a default page size', () => {
  assert.equal(validateCandidate(setup({guestAlignment: {start: 4}})).guest.start, 100);
  rejects(() => validateCandidate(setup({guestAlignment: {start: 16}})), /guest interval start/);
});
test('caller-provided linear alignment is independent of guest alignment', () => {
  rejects(() => validateCandidate(setup({linearAlignment: {start: 16}})), /linear interval start/);
});
test('invalid reservation metadata is rejected, not silently skipped', () => {
  rejects(() => validateCandidate(setup({guestReservations: [reservation('', g(64, 256))]})), /nonempty owner/);
  rejects(() => validateCandidate(setup({linearReservations: [reservation('requested-region', g(1064, 1256))]})), /must use linear/);
  rejects(() => validateCandidate(setup({guestReservations: undefined})), /explicit array/);
});
test('occupied list with wrong address space is rejected', () => {
  rejects(() => validateCandidate(setup({occupiedLinear: [g(1100, 1200)]})), /must be linear/);
});
test('candidate itself must be a guest interval with explicit owner', () => {
  rejects(() => validateCandidate(setup({candidate: l(100, 200)})), /Candidate must be a guest/);
  rejects(() => validateCandidate(setup({owner: ''})), /explicit nonempty candidate owner/);
});
test('supports safe large guest offsets without bitwise truncation', () => {
  const candidate = g(2 ** 40, 2 ** 40 + 4096);
  const base = 1 << 20;
  const options = {
    owner: 'large', candidate, guestBase: base,
    guestLimit: 2 ** 40 + 8192, memoryByteLength: 2 ** 40 + 8192 + base,
    guestReservations: [reservation('large', candidate)],
    linearReservations: [reservation('large', guestToLinear(candidate, base))]
  };
  assert.deepEqual(validateCandidate(options).linear, guestToLinear(candidate, base));
});
