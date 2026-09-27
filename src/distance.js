export function distanceKm(from, to) {
  const coordinates = [from?.latitude, from?.longitude, to?.latitude, to?.longitude]
  if (coordinates.some(value => value == null || value === '' || !Number.isFinite(Number(value)))) return Number.POSITIVE_INFINITY
  const [fromLatitude, fromLongitude, toLatitude, toLongitude] = coordinates.map(Number)
  if (Math.abs(fromLatitude) > 90 || Math.abs(toLatitude) > 90 || Math.abs(fromLongitude) > 180 || Math.abs(toLongitude) > 180) return Number.POSITIVE_INFINITY
  const radians = value => value * Math.PI / 180
  const latDelta = radians(toLatitude - fromLatitude)
  const lngDelta = radians(toLongitude - fromLongitude)
  const a = Math.sin(latDelta / 2) ** 2 + Math.cos(radians(fromLatitude)) * Math.cos(radians(toLatitude)) * Math.sin(lngDelta / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
