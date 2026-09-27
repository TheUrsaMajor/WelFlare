import test from 'node:test'
import assert from 'node:assert/strict'
import { distanceKm } from '../src/distance.js'
import { isDonationAvailable } from '../src/donationRules.js'

test('distance is zero for the same valid coordinates', () => {
  assert.equal(distanceKm({ latitude: 12.97, longitude: 77.59 }, { latitude: 12.97, longitude: 77.59 }), 0)
})

test('distance is finite for two valid locations', () => {
  const km = distanceKm({ latitude: 12.97, longitude: 77.59 }, { latitude: 13.08, longitude: 80.27 })
  assert.ok(km > 0 && km < 400)
})

test('missing or empty coordinates are sorted after known distances', () => {
  assert.equal(distanceKm({ latitude: 12, longitude: 77 }, { latitude: null, longitude: null }), Number.POSITIVE_INFINITY)
  assert.equal(distanceKm({ latitude: 12, longitude: 77 }, { latitude: '', longitude: '' }), Number.POSITIVE_INFINITY)
})

test('out-of-range coordinates are rejected', () => {
  assert.equal(distanceKm({ latitude: 91, longitude: 77 }, { latitude: 12, longitude: 77 }), Number.POSITIVE_INFINITY)
})

test('pickup listings disappear when the pickup deadline passes', () => {
  const now = Date.parse('2026-09-28T20:00:00Z')
  assert.equal(isDonationAvailable({ category: 'items', pickupDeadline: '2026-09-28T20:01:00Z' }, now), true)
  assert.equal(isDonationAvailable({ category: 'items', pickupDeadline: '2026-09-28T19:59:00Z' }, now), false)
})

test('food listings disappear at best-before time even if pickup is still open', () => {
  const now = Date.parse('2026-09-28T20:00:00Z')
  assert.equal(isDonationAvailable({ category: 'food', pickupDeadline: '2026-09-28T21:00:00Z', expiresAt: '2026-09-28T19:59:00Z' }, now), false)
  assert.equal(isDonationAvailable({ category: 'food', pickupDeadline: '2026-09-28T21:00:00Z', expiresAt: '2026-09-28T20:01:00Z' }, now), true)
})

test('an invalid deadline is hidden instead of staying available indefinitely', () => {
  assert.equal(isDonationAvailable({ category: 'items', pickupDeadline: 'not a date' }, Date.now()), false)
})
