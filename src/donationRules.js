function isCurrentOrUnbounded(value, now) {
  if (!value) return true
  const time = new Date(value).getTime()
  return Number.isFinite(time) && time > now
}

export function isDonationAvailable(donation, now = Date.now()) {
  return isCurrentOrUnbounded(donation?.pickupDeadline, now)
    && (donation?.category !== 'food' || isCurrentOrUnbounded(donation?.expiresAt, now))
}
