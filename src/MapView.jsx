import React, { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const defaultCenter = [22.5, 79]

function markerIcon(active = false) {
  return L.divIcon({
    className: 'welflare-map-pin-wrap',
    html: `<span class="welflare-map-pin${active ? ' selected' : ''}"></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })
}

export default function MapView({ points = [], selectedPoint = null, onSelect, className = '' }) {
  const host = useRef(null)
  const map = useRef(null)
  const markers = useRef(null)
  const onSelectRef = useRef(onSelect)
  const [mapError, setMapError] = useState('')

  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])

  useEffect(() => {
    if (!host.current || map.current) return
    let instance
    try {
      instance = L.map(host.current, { scrollWheelZoom: false, zoomControl: true }).setView(defaultCenter, 4)
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      }).addTo(instance)
      markers.current = L.layerGroup().addTo(instance)
      instance.on('click', event => onSelectRef.current?.({ latitude: event.latlng.lat, longitude: event.latlng.lng }))
      map.current = instance
    } catch (error) {
      setMapError(error instanceof Error ? error.message : 'The map could not be loaded.')
      return
    }
    const resize = window.setTimeout(() => instance.invalidateSize(), 0)
    return () => {
      window.clearTimeout(resize)
      instance.remove()
      map.current = null
      markers.current = null
    }
  }, [])

  useEffect(() => {
    const instance = map.current
    if (!instance || !markers.current) return
    try {
      const pointsWithCoords = points.filter(point => point.latitude != null && point.longitude != null && Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude)))
      markers.current.clearLayers()
      pointsWithCoords.forEach(point => {
        L.marker([Number(point.latitude), Number(point.longitude)], { icon: markerIcon() })
          .bindPopup(`<strong>${escapeHtml(point.name || 'Donation')}</strong><br>${escapeHtml(point.place || '')}`)
          .addTo(markers.current)
      })
      if (selectedPoint?.latitude != null && selectedPoint?.longitude != null && Number.isFinite(Number(selectedPoint.latitude)) && Number.isFinite(Number(selectedPoint.longitude))) {
        L.marker([Number(selectedPoint.latitude), Number(selectedPoint.longitude)], { icon: markerIcon(true) })
          .bindPopup('Selected pickup area')
          .addTo(markers.current)
        instance.setView([Number(selectedPoint.latitude), Number(selectedPoint.longitude)], Math.max(instance.getZoom(), 13))
      } else if (pointsWithCoords.length) {
        instance.fitBounds(L.latLngBounds(pointsWithCoords.map(point => [Number(point.latitude), Number(point.longitude)])), { padding: [30, 30], maxZoom: 13 })
      }
    } catch (error) { setMapError(error instanceof Error ? error.message : 'The map pins could not be loaded.') }
  }, [points, selectedPoint?.latitude, selectedPoint?.longitude])

  return <div className={`map-view ${className}`}><div className="map-canvas" ref={host} />{mapError && <p className="map-error">The map could not be loaded: {mapError}. You can still enter a pickup area or use your device location.</p>}<small className="map-attribution">Map data &copy; OpenStreetMap contributors · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Report a map issue</a></small></div>
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}
