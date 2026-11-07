/**
 * Pure, side-effect-free validation of nonempty, half-open memory intervals.
 *
 * `guest` addresses and `linear` offsets are different address spaces. A
 * guest interval [start,end) maps to [guestBase+start,guestBase+end) in linear
 * memory; guestBase is a linear offset, NOT a guest allocation or reservation.
 *
 * The caller must supply trustworthy reservation records for BOTH spaces.
 * This module cannot discover OS/guest allocations or prove the provenance of
 * caller-supplied ownership records. Bounds and zero-filled bytes are never
 * treated as evidence of ownership (memory contents are not inspected).
 */

const SPACES = new Set(['guest', 'linear']);

function safeNonnegative(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

function validInterval(value, label = 'interval') {
  if (!value || typeof value !== 'object' || !SPACES.has(value.space)) {
    throw new TypeError(`${label}.space must be "guest" or "linear"`);
  }
  safeNonnegative(value.start, `${label}.start`);
  safeNonnegative(value.end, `${label}.end`);
  if (value.start >= value.end) {
    throw new RangeError(`${label} must be a nonempty half-open interval [start,end)`);
  }
  return value;
}

function sameSpace(left, right) {
  validInterval(left, 'left');
  validInterval(right, 'right');
  if (left.space !== right.space) {
    throw new TypeError('Cannot compare guest addresses with linear offsets');
  }
}

/** Creates a nonempty [start,end) interval tagged with its address space. */
export function makeInterval(space, start, end) {
  return Object.freeze({ ...validInterval({space, start, end}) });
}

/** Adjacent half-open intervals do not overlap. Throws on space mismatch. */
export function overlaps(left, right) {
  sameSpace(left, right);
  return left.start < right.end && right.start < left.end;
}

/** True when the complete inner interval is in outer, endpoints included. */
export function contains(outer, inner) {
  sameSpace(outer, inner);
  return outer.start <= inner.start && inner.end <= outer.end;
}

/** Verify [start,end) lies within [0,limit); limit is an exclusive bound. */
export function assertBounds(range, limit) {
  validInterval(range);
  safeNonnegative(limit, 'limit');
  if (range.end > limit) throw new RangeError(`${range.space} interval exceeds its bound`);
  return true;
}

/** Optional start/end alignment: no alignment is imposed unless requested. */
export function assertAlignment(range, {start = 1, end = 1} = {}) {
  validInterval(range);
  for (const [label, value] of [['start', start], ['end', end]]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${label} alignment must be a positive safe integer`);
    }
    if (range[label] % value !== 0) {
      throw new RangeError(`${range.space} interval ${label} is not ${value}-aligned`);
    }
  }
  return true;
}

/** Offset a guest VA into a linear offset, rejecting unsafe arithmetic. */
export function guestToLinear(guest, guestBase) {
  validInterval(guest, 'guest');
  if (guest.space !== 'guest') throw new TypeError('Expected guest address interval');
  safeNonnegative(guestBase, 'guestBase');
  const start = guestBase + guest.start;
  const end = guestBase + guest.end;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
    throw new RangeError('Guest-to-linear offset exceeds safe integer range');
  }
  return makeInterval('linear', start, end);
}

function reservations(list, space, limit, label) {
  if (!Array.isArray(list)) throw new TypeError(`${label} must be an explicit array`);
  return list.map((record, index) => {
    if (!record || typeof record !== 'object' ||
        typeof record.owner !== 'string' || !record.owner.trim()) {
      throw new TypeError(`${label}[${index}] requires a nonempty owner`);
    }
    validInterval(record.interval, `${label}[${index}].interval`);
    if (record.interval.space !== space) {
      throw new TypeError(`${label}[${index}] must use ${space} intervals`);
    }
    assertBounds(record.interval, limit);
    return record;
  });
}

function occupied(list, space, limit, label) {
  if (!Array.isArray(list)) throw new TypeError(`${label} must be an array`);
  return list.map((range, index) => {
    validInterval(range, `${label}[${index}]`);
    if (range.space !== space) throw new TypeError(`${label}[${index}] must be ${space}`);
    assertBounds(range, limit);
    return range;
  });
}

/**
 * Validate a candidate guest placement and its backing linear memory.
 *
 * Input:
 * - owner: nonempty owner identifier (a label, NOT proof of ownership)
 * - candidate: guest interval
 * - guestBase: nonnegative linear offset corresponding to guest address zero
 * - guestLimit, memoryByteLength: exclusive guest and linear bounds
 * - guestReservations, linearReservations: independently supplied records
 *       {owner, interval}; the candidate must fit one matching-owner record
 *       in EACH space. A linear-only malloc allocation never grants guest VA.
 * - occupiedGuest, occupiedLinear: all independently known blocked intervals
 * - guestAlignment, linearAlignment: optional {start,end}, default 1 each
 *
 * Also rejects candidate intersection with another owner's reservation in
 * either space. It does not select an address or mutate a reservation registry.
 */
export function validateCandidate({
  owner, candidate, guestBase, guestLimit, memoryByteLength,
  guestReservations, linearReservations,
  occupiedGuest = [], occupiedLinear = [],
  guestAlignment = {}, linearAlignment = {}
} = {}) {
  if (typeof owner !== 'string' || !owner.trim()) {
    throw new TypeError('An explicit nonempty candidate owner is required');
  }
  validInterval(candidate, 'candidate');
  if (candidate.space !== 'guest') {
    throw new TypeError('Candidate must be a guest interval, not a linear offset');
  }
  safeNonnegative(guestLimit, 'guestLimit');
  safeNonnegative(memoryByteLength, 'memoryByteLength');
  assertBounds(candidate, guestLimit);
  assertAlignment(candidate, guestAlignment);
  const linear = guestToLinear(candidate, guestBase);
  assertBounds(linear, memoryByteLength);
  assertAlignment(linear, linearAlignment);

  const guests = reservations(guestReservations, 'guest', guestLimit, 'guestReservations');
  const linears = reservations(linearReservations, 'linear', memoryByteLength, 'linearReservations');
  const guestBlocks = occupied(occupiedGuest, 'guest', guestLimit, 'occupiedGuest');
  const linearBlocks = occupied(occupiedLinear, 'linear', memoryByteLength, 'occupiedLinear');

  if (!guests.some(r => r.owner === owner && contains(r.interval, candidate))) {
    throw new Error('Candidate is not covered by an explicitly owned guest reservation');
  }
  if (!linears.some(r => r.owner === owner && contains(r.interval, linear))) {
    throw new Error('Backing memory is not covered by an explicitly owned linear reservation');
  }
  if (guestBlocks.some(r => overlaps(r, candidate)) ||
      guests.some(r => r.owner !== owner && overlaps(r.interval, candidate))) {
    throw new Error('Candidate overlaps occupied or differently owned guest memory');
  }
  if (linearBlocks.some(r => overlaps(r, linear)) ||
      linears.some(r => r.owner !== owner && overlaps(r.interval, linear))) {
    throw new Error('Candidate backing overlaps occupied or differently owned linear memory');
  }
  return Object.freeze({owner, guest: makeInterval('guest', candidate.start, candidate.end), linear});
}
