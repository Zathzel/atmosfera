<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import {
  getWeatherByCity,
  getWeatherByCoords,
  describeWeatherCode,
  type WeatherData,
  type AirQuality,
} from './services/weather'

// ─── Types ────────────────────────────────────────────────────────────────────
type Mood = 'clear' | 'cloudy' | 'rain' | 'storm' | 'cold' | 'fog'
type AqiKey = 'ok' | 'fair' | 'warn' | 'poor' | 'danger' | 'hazard'

// ─── State ────────────────────────────────────────────────────────────────────
const searchQuery    = ref('')
const weatherData    = ref<WeatherData | null>(null)
const isLoading      = ref(false)
const errorMsg       = ref('')
const searchHistory  = ref<string[]>([])
const utcClock       = ref('--:--:-- UTC')
const localClock     = ref('--:--')
const displayTemp    = ref(0)
const hasLoaded      = ref(false)
const bgMood         = ref<Mood>('clear')
const activeTab      = ref<'current' | 'forecast' | 'air'>('current')
const showSearch     = ref(false)
const searchFocused  = ref(false)
const particleSeeds  = Array.from({ length: 40 }, (_, i) => ({
  id: i,
  cx: Math.random() * 1200,
  cy: Math.random() * 800,
  r: Math.random() * 1.8 + 0.4,
  delay: Math.random() * 6,
  dur: Math.random() * 4 + 3,
}))

let clockTimer:    ReturnType<typeof setInterval>
let tempRaf:       number | null = null

// ─── Clock ────────────────────────────────────────────────────────────────────
function tickClock() {
  const now = new Date()
  utcClock.value = [
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join(':') + ' UTC'
  localClock.value = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false })
}

// ─── Animated temperature counter ────────────────────────────────────────────
function animateTemp(target: number) {
  if (tempRaf) cancelAnimationFrame(tempRaf)
  const start     = displayTemp.value
  const diff      = target - start
  const duration  = 900
  let   startTime: number | null = null

  const easeOutExpo = (t: number) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t)

  const tick = (ts: number) => {
    if (!startTime) startTime = ts
    const elapsed  = ts - startTime
    const progress = Math.min(elapsed / duration, 1)
    displayTemp.value = Math.round(start + diff * easeOutExpo(progress))
    if (progress < 1) tempRaf = requestAnimationFrame(tick)
    else displayTemp.value = target
  }

  setTimeout(() => { tempRaf = requestAnimationFrame(tick) }, 300)
}

// ─── Mood derivation ──────────────────────────────────────────────────────────
function deriveMood(d: WeatherData): Mood {
  const code = d.current.weather_code
  const temp  = d.current.temperature_2m
  if ([95, 96, 99].includes(code))                               return 'storm'
  if ([51,53,55,61,63,65,80,81,82].includes(code))               return 'rain'
  if ([45, 48].includes(code))                                   return 'fog'
  if ([1, 2, 3].includes(code))                                  return 'cloudy'
  if (temp <= 5)                                                 return 'cold'
  return 'clear'
}

// ─── Mood config ──────────────────────────────────────────────────────────────
const moodConfig: Record<Mood, { label: string; icon: string; accent: string; grad: string }> = {
  clear:  { label: 'Cerah',          icon: '◎', accent: '#E8A020', grad: 'radial-gradient(ellipse 120% 60% at 70% -10%, rgba(232,160,32,0.18) 0%, transparent 70%)' },
  cloudy: { label: 'Berawan',        icon: '◐', accent: '#6B7FA0', grad: 'radial-gradient(ellipse 100% 80% at 50% -20%, rgba(107,127,160,0.15) 0%, transparent 60%)' },
  rain:   { label: 'Hujan',          icon: '◈', accent: '#4A90C4', grad: 'radial-gradient(ellipse 90% 70% at 30% -5%, rgba(74,144,196,0.18) 0%, transparent 65%)' },
  storm:  { label: 'Badai',          icon: '⚡', accent: '#9A5FCC', grad: 'radial-gradient(ellipse 110% 60% at 80% -15%, rgba(154,95,204,0.2) 0%, transparent 70%)' },
  cold:   { label: 'Dingin',         icon: '❄', accent: '#5BA8CC', grad: 'radial-gradient(ellipse 100% 70% at 40% -10%, rgba(91,168,204,0.15) 0%, transparent 65%)' },
  fog:    { label: 'Berkabut',       icon: '◉', accent: '#8C9AA8', grad: 'radial-gradient(ellipse 120% 80% at 50% -10%, rgba(140,154,168,0.12) 0%, transparent 70%)' },
}

// ─── History ──────────────────────────────────────────────────────────────────
function loadHistory() {
  try { searchHistory.value = JSON.parse(localStorage.getItem('atm_v2_history') || '[]') }
  catch { searchHistory.value = [] }
}
function addToHistory(name: string) {
  const next = [name, ...searchHistory.value.filter(c => c.toLowerCase() !== name.toLowerCase())].slice(0, 6)
  searchHistory.value = next
  localStorage.setItem('atm_v2_history', JSON.stringify(next))
}
function clearHistory() {
  searchHistory.value = []
  localStorage.removeItem('atm_v2_history')
}

// ─── Fetch core ───────────────────────────────────────────────────────────────
async function runFetch(fn: () => Promise<WeatherData>) {
  isLoading.value   = true
  errorMsg.value    = ''
  hasLoaded.value   = false
  weatherData.value = null
  try {
    const data        = await fn()
    weatherData.value = data
    bgMood.value      = deriveMood(data)
    addToHistory(data.location.name)
    animateTemp(Math.round(data.current.temperature_2m))
    await new Promise(r => setTimeout(r, 80))
    hasLoaded.value = true
  } catch (e: any) {
    errorMsg.value = e.message || 'Terjadi kesalahan jaringan.'
  } finally {
    isLoading.value = false
  }
}

function handleSearch() {
  if (!searchQuery.value.trim()) return
  showSearch.value = false
  runFetch(() => getWeatherByCity(searchQuery.value))
}
function handleChipSearch(city: string) {
  searchQuery.value = city
  runFetch(() => getWeatherByCity(city))
}
async function autoLocate() {
  if (!navigator.geolocation) { errorMsg.value = 'Geolokasi tidak tersedia di browser ini.'; return }
  isLoading.value = true
  errorMsg.value  = ''
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => runFetch(() => getWeatherByCoords(coords.latitude, coords.longitude)),
    () => { errorMsg.value = 'Izin lokasi ditolak. Coba cari nama kota secara manual.'; isLoading.value = false },
    { timeout: 10000 },
  )
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
onMounted(() => {
  loadHistory()
  tickClock()
  clockTimer = setInterval(tickClock, 1000)
  autoLocate()
})
onUnmounted(() => {
  clearInterval(clockTimer)
  if (tempRaf) cancelAnimationFrame(tempRaf)
})

// ─── Computed ─────────────────────────────────────────────────────────────────
const currentMoodConfig = computed(() => moodConfig[bgMood.value])

const conditionStatus = computed<'ok' | 'warn' | 'critical'>(() => {
  if (!weatherData.value) return 'ok'
  const { temperature_2m, wind_speed_10m } = weatherData.value.current
  if (temperature_2m > 40 || temperature_2m < 0 || wind_speed_10m > 60) return 'critical'
  if (temperature_2m > 35 || temperature_2m < 5  || wind_speed_10m > 30) return 'warn'
  return 'ok'
})

const conditionLabel = computed(() => {
  if (!weatherData.value) return ''
  const { temperature_2m, wind_speed_10m } = weatherData.value.current
  if (temperature_2m > 40)   return 'Bahaya Panas'
  if (temperature_2m > 35)   return 'Panas Ekstrem'
  if (temperature_2m < 0)    return 'Bahaya Beku'
  if (temperature_2m < 5)    return 'Suhu Kritis'
  if (wind_speed_10m > 60)   return 'Badai Angin'
  if (wind_speed_10m > 30)   return 'Angin Kencang'
  return 'Kondisi Normal'
})

function degToCompass(deg: number): string {
  const dirs = ['U', 'UTL', 'TL', 'TTG', 'T', 'TTG', 'TG', 'BTG', 'S', 'BSD', 'BD', 'BBD', 'B', 'BBL', 'BL', 'UBL']
  return dirs[Math.round(deg / 22.5) % 16]
}

const AQI_TOKENS: Record<AqiKey, { fg: string; bg: string; label: string }> = {
  ok:     { fg: '#1D6A4A', bg: '#E0F0E8', label: 'Baik' },
  fair:   { fg: '#7A5200', bg: '#FEF4D0', label: 'Sedang' },
  warn:   { fg: '#8A3800', bg: '#FDE8DC', label: 'Tidak Sehat (Sensitif)' },
  poor:   { fg: '#7A1010', bg: '#FDE0E0', label: 'Tidak Sehat' },
  danger: { fg: '#6A0A50', bg: '#F8E0F0', label: 'Sangat Tidak Sehat' },
  hazard: { fg: '#F5F2EA', bg: '#1A0A10', label: 'Berbahaya' },
}
function aqiTokens(aq: AirQuality) {
  return AQI_TOKENS[aq.aqi_color as AqiKey] ?? { fg: '#5C5A55', bg: 'transparent', label: aq.aqi_label }
}

const directives = computed(() => {
  if (!weatherData.value) return []
  const c  = weatherData.value.current
  const d  = weatherData.value.daily
  const aq = weatherData.value.air_quality
  const list: { icon: string; text: string; severity: 'info' | 'warn' | 'critical' }[] = []

  if (c.temperature_2m <= 10)       list.push({ icon: '🧥', text: 'Suhu rendah — pakaian berlapis sangat dianjurkan', severity: c.temperature_2m <= 0 ? 'critical' : 'warn' })
  if (c.temperature_2m >= 38)       list.push({ icon: '🌡', text: 'Panas berbahaya — hindari paparan langsung, perbanyak cairan', severity: 'critical' })
  else if (c.temperature_2m >= 32)  list.push({ icon: '☀', text: 'Suhu tinggi — jaga hidrasi, batasi aktivitas fisik berat', severity: 'warn' })
  if (c.wind_speed_10m >= 50)       list.push({ icon: '🌪', text: `Angin badai ${c.wind_speed_10m} km/h dari ${degToCompass(c.wind_direction_10m)} — tetap di dalam ruangan`, severity: 'critical' })
  else if (c.wind_speed_10m >= 25)  list.push({ icon: '💨', text: `Angin ${degToCompass(c.wind_direction_10m)} ${c.wind_speed_10m} km/h — amankan benda-benda ringan`, severity: 'warn' })
  if (c.wind_gusts_10m >= 60)       list.push({ icon: '⚠', text: `Hembusan hingga ${c.wind_gusts_10m} km/h — hindari area terbuka`, severity: 'critical' })
  if (d.uv_index_max[0] >= 8)       list.push({ icon: '🕶', text: `UV sangat tinggi (${d.uv_index_max[0]}) — tabir surya SPF 50+ wajib, hindari pukul 10–14`, severity: 'warn' })
  else if (d.uv_index_max[0] >= 6)  list.push({ icon: '🧴', text: `UV tinggi (${d.uv_index_max[0]}) — aplikasikan tabir surya sebelum keluar`, severity: 'info' })
  if (c.precipitation > 5)          list.push({ icon: '🌧', text: `Hujan deras ${c.precipitation} mm — siapkan jas hujan, perhatikan potensi banjir`, severity: 'warn' })
  else if (c.precipitation > 0)     list.push({ icon: '☂', text: 'Hujan ringan aktif — bawa payung atau jas hujan', severity: 'info' })
  if (c.visibility < 500)           list.push({ icon: '🔦', text: `Jarak pandang hanya ${c.visibility} m — berkendara ekstra hati-hati`, severity: 'critical' })
  else if (c.visibility < 2000)     list.push({ icon: '👁', text: `Pandang terbatas ${(c.visibility/1000).toFixed(1)} km — nyalakan lampu kendaraan`, severity: 'warn' })
  if (c.relative_humidity_2m >= 90) list.push({ icon: '💧', text: 'Kelembapan ekstrem — risiko heat stress tinggi, sirkulasi udara penting', severity: 'warn' })
  if (aq && aq.aqi > 100)           list.push({ icon: '😷', text: `Kualitas udara buruk (AQI ${aq.aqi}) — gunakan masker N95 di luar ruangan`, severity: aq.aqi > 150 ? 'critical' : 'warn' })
  else if (aq && aq.aqi > 50)       list.push({ icon: '🌬', text: `Udara ${aqiTokens(aq).label} (AQI ${aq.aqi}) — perhatikan kelompok sensitif`, severity: 'info' })
  if (list.length === 0)            list.push({ icon: '✓', text: 'Semua parameter dalam batas normal — kondisi ideal untuk aktivitas di luar', severity: 'info' })
  return list
})

// Forecast range normalization
const forecastRange = computed(() => {
  if (!weatherData.value) return { min: 0, range: 1 }
  const mins = weatherData.value.daily.temperature_2m_min.slice(0, 7)
  const maxs = weatherData.value.daily.temperature_2m_max.slice(0, 7)
  const min  = Math.min(...mins)
  const max  = Math.max(...maxs)
  return { min, range: (max - min) || 1 }
})

function barLeft(t: number) {
  return `${(((t - forecastRange.value.min) / forecastRange.value.range) * 30).toFixed(1)}%`
}
function barWidth(tMin: number, tMax: number) {
  const left  = (tMin - forecastRange.value.min) / forecastRange.value.range * 30
  const right = (tMax - forecastRange.value.min) / forecastRange.value.range * 30 + 40
  return `${(right - left).toFixed(1)}%`
}

// Helpers
function getDayName(d: string)    { return new Date(d).toLocaleDateString('id-ID', { weekday: 'short' }) }
function getDateNum(d: string)    { return new Date(d).getDate() }
function getMonthShort(d: string) { return new Date(d).toLocaleDateString('id-ID', { month: 'short' }) }
function formatTime(d: string)    { return new Date(d).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }) }
function formatDaylight(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}j ${m}m`
}
function fmtCoord(n: number, p: string, neg: string) {
  return `${Math.abs(n).toFixed(3)}°${n >= 0 ? p : neg}`
}

// UV scale
function uvColor(uv: number): string {
  if (uv <= 2)  return '#4CAF50'
  if (uv <= 5)  return '#D4A017'
  if (uv <= 7)  return '#E07020'
  if (uv <= 10) return '#C0392B'
  return '#8E44AD'
}
function uvLabel(uv: number): string {
  if (uv <= 2)  return 'Rendah'
  if (uv <= 5)  return 'Sedang'
  if (uv <= 7)  return 'Tinggi'
  if (uv <= 10) return 'Sangat Tinggi'
  return 'Ekstrem'
}

// Sun arc progress
const sunProgress = computed(() => {
  if (!weatherData.value) return 0
  const now  = Date.now()
  const rise = new Date(weatherData.value.daily.sunrise[0]).getTime()
  const set  = new Date(weatherData.value.daily.sunset[0]).getTime()
  if (now <= rise) return 0
  if (now >= set)  return 1
  return (now - rise) / (set - rise)
})

const SUN_R = 108
const SUN_CX = 140
const SUN_CY = 130

const sunDotPos = computed(() => {
  const angle = Math.PI * (1 - sunProgress.value)
  return {
    x: SUN_CX + SUN_R * Math.cos(angle),
    y: SUN_CY - SUN_R * Math.sin(angle),
  }
})

const sunArcLength = 2 * Math.PI * SUN_R / 2  // semicircle ≈ 339.3
const sunDashOffset = computed(() => sunArcLength * (1 - sunProgress.value))

// Hourly temp sparkline (use daily highs/lows as proxy if no hourly)
const sparkPath = computed(() => {
  if (!weatherData.value) return ''
  const maxs = weatherData.value.daily.temperature_2m_max.slice(0, 7)
  const mins  = weatherData.value.daily.temperature_2m_min.slice(0, 7)
  const allT  = [...maxs, ...mins]
  const mn = Math.min(...allT)
  const mx = Math.max(...allT)
  const rng = mx - mn || 1
  const W = 280, H = 50
  const pts = maxs.map((t, i) => {
    const x = (i / (maxs.length - 1)) * W
    const y = H - ((t - mn) / rng) * H
    return `${x},${y}`
  })
  return `M${pts.join(' L')}`
})
</script>

<template>
  <div
    class="shell"
    :data-mood="bgMood"
    :style="{ '--mood-accent': currentMoodConfig.accent, '--mood-grad': currentMoodConfig.grad }"
  >

    <!-- ── Generative SVG canvas ──────────────────────────────────────────── -->
    <div class="bg-canvas" aria-hidden="true">
      <svg class="bg-svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="blur-soft">
            <feGaussianBlur stdDeviation="40"/>
          </filter>
          <radialGradient id="glow-center" cx="70%" cy="15%" r="50%">
            <stop offset="0%" stop-color="var(--mood-accent)" stop-opacity="0.25"/>
            <stop offset="100%" stop-color="var(--mood-accent)" stop-opacity="0"/>
          </radialGradient>
        </defs>

        <!-- Ambient glow -->
        <rect width="1200" height="800" fill="url(#glow-center)"/>

        <!-- CLEAR: harmonic concentric rings -->
        <g v-if="bgMood === 'clear'" class="mood-layer">
          <circle v-for="i in 14" :key="i"
            :r="i * 52" cx="950" cy="80"
            fill="none" stroke="var(--mood-accent)"
            :stroke-width="i % 3 === 0 ? 0.7 : 0.25"
            :opacity="0.5 - i * 0.032"
            :style="`animation-delay:${i*0.15}s`"
            class="ring"
          />
          <!-- Starburst lines -->
          <line v-for="i in 18" :key="`s${i}`"
            :x1="950 + Math.cos(i * 20 * Math.PI/180) * 30"
            :y1="80  + Math.sin(i * 20 * Math.PI/180) * 30"
            :x2="950 + Math.cos(i * 20 * Math.PI/180) * 700"
            :y2="80  + Math.sin(i * 20 * Math.PI/180) * 700"
            stroke="var(--mood-accent)" :stroke-width="i%6===0?0.5:0.15"
            :opacity="0.06 + (i%3)*0.02"
          />
        </g>

        <!-- RAIN: animated falling lines -->
        <g v-if="bgMood === 'rain'" class="mood-layer">
          <line v-for="p in particleSeeds.slice(0,24)" :key="p.id"
            :x1="p.cx" :y1="-20"
            :x2="p.cx - 60" :y2="820"
            stroke="#4A90C4"
            :stroke-width="p.r * 0.6"
            :opacity="0.06 + p.r * 0.04"
            class="rain-line"
            :style="`animation-duration:${p.dur * 0.5}s; animation-delay:${p.delay * 0.3}s`"
          />
        </g>

        <!-- CLOUDY: layered blobs -->
        <g v-if="bgMood === 'cloudy'" class="mood-layer">
          <ellipse cx="180"  cy="130" rx="340" ry="130" fill="none" stroke="#6B7FA0" stroke-width="0.6" opacity="0.12" class="blob blob-1"/>
          <ellipse cx="880"  cy="580" rx="380" ry="150" fill="none" stroke="#6B7FA0" stroke-width="0.5" opacity="0.10" class="blob blob-2"/>
          <ellipse cx="550"  cy="300" rx="240" ry="100" fill="none" stroke="#6B7FA0" stroke-width="0.4" opacity="0.08" class="blob blob-3"/>
          <ellipse cx="1050" cy="200" rx="200" ry="80"  fill="none" stroke="#6B7FA0" stroke-width="0.4" opacity="0.08" class="blob blob-4"/>
        </g>

        <!-- STORM: dramatic lightning bolts -->
        <g v-if="bgMood === 'storm'" class="mood-layer">
          <polyline v-for="i in 10" :key="i"
            :points="`${i*120},0 ${i*120-70},350 ${i*120+50},350 ${i*120-30},800`"
            fill="none" stroke="#9A5FCC"
            :stroke-width="i%3===0 ? 1.2 : 0.4"
            :opacity="0.05 + (i%4)*0.03"
            class="lightning"
            :style="`animation-delay:${i*0.12}s`"
          />
        </g>

        <!-- COLD: geometric snowflake pattern -->
        <g v-if="bgMood === 'cold'" class="mood-layer">
          <circle v-for="p in particleSeeds" :key="p.id"
            :cx="p.cx" :cy="p.cy" :r="p.r"
            fill="#5BA8CC"
            :opacity="0.03 + p.r * 0.03"
            class="snowdot"
            :style="`animation-delay:${p.delay}s; animation-duration:${p.dur}s`"
          />
        </g>

        <!-- FOG: layered horizontal bands -->
        <g v-if="bgMood === 'fog'" class="mood-layer">
          <rect v-for="i in 8" :key="i"
            x="-100" :y="i * 100 - 40" width="1400" :height="30"
            fill="#8C9AA8"
            :opacity="0.03 + (i%3)*0.01"
            rx="15"
            class="fog-band"
            :style="`animation-delay:${i*0.4}s`"
          />
        </g>

        <!-- Large watermark temperature -->
        <text x="52%" y="108%"
          dominant-baseline="auto" text-anchor="middle"
          class="bg-watermark" fill="var(--mood-accent)" opacity="0.055"
          font-size="420" font-family="'Playfair Display', Georgia, serif"
          font-weight="900" font-style="italic"
        >
          {{ weatherData ? Math.round(weatherData.current.temperature_2m) : '' }}
        </text>
      </svg>
    </div>

    <!-- ── Noise grain ────────────────────────────────────────────────────── -->
    <div class="grain" aria-hidden="true"/>

    <!-- ── Top navigation bar ────────────────────────────────────────────── -->
    <header class="topbar">
      <div class="topbar-brand">
        <div class="brand-icon" :style="{ color: 'var(--mood-accent)' }">{{ currentMoodConfig.icon }}</div>
        <div class="brand-text">
          <span class="brand-name">ATMOSFERA</span>
          <span class="brand-sub">Weather Intelligence</span>
        </div>
      </div>

      <nav class="topbar-nav">
        <button
          v-for="tab in [
            { id: 'current',  label: 'Sekarang' },
            { id: 'forecast', label: 'Prakiraan' },
            { id: 'air',      label: 'Udara' },
          ] as const"
          :key="tab.id"
          class="nav-tab"
          :class="{ 'is-active': activeTab === tab.id }"
          @click="activeTab = tab.id"
          :disabled="!weatherData"
        >
          {{ tab.label }}
        </button>
      </nav>

      <div class="topbar-right">
        <div class="clock-block">
          <div class="clock-local">{{ localClock }}</div>
          <div class="clock-utc">{{ utcClock }}</div>
        </div>
        <button class="search-toggle" :class="{ 'is-open': showSearch }" @click="showSearch = !showSearch" :aria-label="showSearch ? 'Tutup pencarian' : 'Cari kota'">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
        <button class="locate-btn-icon" @click="autoLocate" :disabled="isLoading" title="Lokasi otomatis">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="12" cy="12" r="3"/>
            <line x1="12" y1="2" x2="12" y2="5"/>
            <line x1="12" y1="19" x2="12" y2="22"/>
            <line x1="2" y1="12" x2="5" y2="12"/>
            <line x1="19" y1="12" x2="22" y2="12"/>
          </svg>
        </button>
      </div>
    </header>

    <!-- ── Search drawer ─────────────────────────────────────────────────── -->
    <Transition name="drawer">
      <div v-if="showSearch" class="search-drawer">
        <div class="search-inner">
          <div class="search-field-wrap" :class="{ 'is-focused': searchFocused }">
            <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              v-model="searchQuery"
              class="search-field"
              type="text"
              placeholder="Nama kota, contoh: Jakarta, Surabaya, Bandung…"
              autofocus
              @keydown.enter="handleSearch"
              @focus="searchFocused = true"
              @blur="searchFocused = false"
            />
            <button class="search-go" @click="handleSearch" :disabled="!searchQuery.trim()">
              <span v-if="!isLoading">Cari</span>
              <span v-else class="spin">◌</span>
            </button>
          </div>

          <div v-if="searchHistory.length" class="drawer-history">
            <span class="drawer-history-label">Riwayat</span>
            <button
              v-for="city in searchHistory"
              :key="city"
              class="drawer-chip"
              @click="handleChipSearch(city)"
            >{{ city }}</button>
            <button class="drawer-clear" @click="clearHistory">Hapus</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── Status bar ─────────────────────────────────────────────────────── -->
    <Transition name="status-bar">
      <div v-if="errorMsg" class="status-error" role="alert">
        <span class="status-err-icon">!</span>
        {{ errorMsg }}
        <button class="status-dismiss" @click="errorMsg = ''">✕</button>
      </div>
    </Transition>

    <!-- ── Loading state ──────────────────────────────────────────────────── -->
    <Transition name="fade">
      <div v-if="isLoading" class="loading-stage">
        <div class="loader-orb">
          <div class="orb-ring orb-ring--1"/>
          <div class="orb-ring orb-ring--2"/>
          <div class="orb-ring orb-ring--3"/>
          <div class="orb-core">{{ currentMoodConfig.icon }}</div>
        </div>
        <div class="loader-label">Mengambil data cuaca…</div>
        <div class="loader-dots">
          <span v-for="n in 4" :key="n" class="dot" :style="`animation-delay:${n*0.18}s`"/>
        </div>
      </div>
    </Transition>

    <!-- ── Empty state ────────────────────────────────────────────────────── -->
    <Transition name="fade">
      <div v-if="!isLoading && !weatherData && !errorMsg" class="empty-stage">
        <div class="empty-hero">
          <div class="empty-icon">◎</div>
          <h2 class="empty-title">ATMOSFERA</h2>
          <p class="empty-sub">Laporan cuaca berkualitas tinggi untuk Indonesia &amp; seluruh dunia</p>
        </div>
        <div class="empty-actions">
          <button class="empty-action-btn" @click="autoLocate">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            Gunakan Lokasi Saya
          </button>
          <button class="empty-action-btn empty-action-btn--secondary" @click="showSearch = true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            Cari Kota
          </button>
        </div>
        <div class="empty-cities">
          <span class="empty-cities-label">Populer</span>
          <button v-for="c in ['Jakarta','Bali','Surabaya','Yogyakarta','Medan','Makassar']" :key="c"
            class="city-pill" @click="handleChipSearch(c)">{{ c }}</button>
        </div>
      </div>
    </Transition>

    <!-- ══════════════════════════════════════════════════════════════════════
         MAIN CONTENT
    ══════════════════════════════════════════════════════════════════════════ -->
    <Transition name="page-reveal">
      <main v-if="weatherData && !isLoading" class="main-content" :class="{ 'is-ready': hasLoaded }">

        <!-- ── HERO SECTION ────────────────────────────────────────────────── -->
        <section class="hero">

          <!-- Left: Location meta -->
          <div class="hero-location">
            <div class="location-breadcrumb">
              <span class="breadcrumb-item">{{ weatherData.location.country }}</span>
              <span class="breadcrumb-sep">›</span>
              <span class="breadcrumb-item">{{ fmtCoord(weatherData.location.latitude, 'N', 'S') }}</span>
              <span class="breadcrumb-sep">·</span>
              <span class="breadcrumb-item">{{ fmtCoord(weatherData.location.longitude, 'T', 'B') }}</span>
            </div>

            <h1 class="city-name">{{ weatherData.location.name }}</h1>

            <div class="condition-badge">
              <span class="condition-icon" :style="{ color: 'var(--mood-accent)' }">{{ currentMoodConfig.icon }}</span>
              <span class="condition-text">{{ describeWeatherCode(weatherData.current.weather_code) }}</span>
            </div>

            <!-- Alert band -->
            <div class="alert-band" :class="`alert-band--${conditionStatus}`">
              <span class="alert-dot"/>
              <span>{{ conditionLabel }}</span>
            </div>

            <!-- AQI badge -->
            <div v-if="weatherData.air_quality" class="aqi-badge"
              :style="{
                background: aqiTokens(weatherData.air_quality).bg,
                color: aqiTokens(weatherData.air_quality).fg,
              }"
            >
              <span class="aqi-badge-num">{{ weatherData.air_quality.aqi }}</span>
              <div class="aqi-badge-divider"/>
              <div class="aqi-badge-info">
                <span class="aqi-badge-label">{{ aqiTokens(weatherData.air_quality).label }}</span>
                <span class="aqi-badge-poll">{{ weatherData.air_quality.dominant_pollutant }} · AQI</span>
              </div>
            </div>

            <!-- Sparkline mini chart -->
            <div class="sparkline-wrap">
              <svg viewBox="0 0 280 50" class="sparkline-svg" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--mood-accent)" stop-opacity="0.25"/>
                    <stop offset="100%" stop-color="var(--mood-accent)" stop-opacity="0"/>
                  </linearGradient>
                </defs>
                <path :d="sparkPath + ' V50 H0 Z'" fill="url(#spark-fill)"/>
                <path :d="sparkPath" fill="none" stroke="var(--mood-accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="spark-line"/>
              </svg>
              <div class="sparkline-label">7-hari maks · {{ weatherData.daily.temperature_2m_max.slice(0,7).map(t => Math.round(t)).join(' · ') }}°</div>
            </div>

            <div class="hero-meta">
              <span class="meta-time">
                Diperbarui {{ new Date(weatherData.fetched_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) }}
              </span>
              <span class="meta-sep">·</span>
              <span class="meta-src">Open-Meteo</span>
            </div>
          </div>

          <!-- Center: Mega temperature -->
          <div class="hero-temp-block">
            <div class="temp-mega">
              <span class="temp-number">{{ displayTemp }}</span>
              <div class="temp-meta-col">
                <span class="temp-deg">°C</span>
                <span class="temp-feel">Terasa {{ Math.round(weatherData.current.apparent_temperature) }}°</span>
                <span class="temp-range">
                  ↑{{ Math.round(weatherData.daily.temperature_2m_max[0]) }}° ↓{{ Math.round(weatherData.daily.temperature_2m_min[0]) }}°
                </span>
              </div>
            </div>

            <!-- Humidity arc gauge -->
            <div class="gauge-wrap">
              <svg viewBox="0 0 100 60" class="gauge-svg">
                <path d="M10,50 A40,40 0 0 1 90,50" fill="none" stroke="var(--surface-2)" stroke-width="4" stroke-linecap="round"/>
                <path d="M10,50 A40,40 0 0 1 90,50" fill="none" stroke="var(--mood-accent)" stroke-width="4" stroke-linecap="round"
                  stroke-dasharray="125.7"
                  :stroke-dashoffset="125.7 * (1 - weatherData.current.relative_humidity_2m / 100)"
                  class="gauge-arc"
                />
                <text x="50" y="46" text-anchor="middle" font-size="12" fill="var(--text-1)" font-family="'Playfair Display',Georgia,serif" font-weight="700">
                  {{ weatherData.current.relative_humidity_2m }}%
                </text>
                <text x="50" y="57" text-anchor="middle" font-size="5.5" fill="var(--text-3)" font-family="'DM Mono',monospace" letter-spacing="0.05em">
                  KELEMBAPAN
                </text>
              </svg>
            </div>
          </div>

          <!-- Right: Key metrics strip -->
          <div class="hero-stats">
            <div class="stat-card" v-for="(item, i) in [
              { label: 'Angin',      value: weatherData.current.wind_speed_10m, unit: 'km/h', sub: degToCompass(weatherData.current.wind_direction_10m), icon: '→' },
              { label: 'Pandang',   value: (weatherData.current.visibility / 1000).toFixed(1), unit: 'km',   sub: 'jarak pandang', icon: '◎' },
              { label: 'Tutup Awan', value: weatherData.current.cloud_cover,    unit: '%',    sub: 'penutupan', icon: '◐' },
              { label: 'Tekanan',   value: weatherData.current.surface_pressure, unit: 'hPa', sub: 'permukaan', icon: '⊙' },
            ]" :key="item.label" :style="`--i:${i}`">
              <div class="sc-header">
                <span class="sc-icon" :style="{ color: 'var(--mood-accent)' }">{{ item.icon }}</span>
                <span class="sc-label">{{ item.label }}</span>
              </div>
              <div class="sc-value">
                <span class="sc-num">{{ item.value }}</span>
                <span class="sc-unit">{{ item.unit }}</span>
              </div>
              <div class="sc-sub">{{ item.sub }}</div>
              <div class="sc-bar-track">
                <div class="sc-bar-fill" :style="{ width: `${Math.min(Math.abs(Number(item.value)) / (item.unit==='hPa'?1013:100) * 100, 100)}%` }"/>
              </div>
            </div>
          </div>
        </section>

        <!-- ── TAB PANEL ───────────────────────────────────────────────────── -->
        <div class="divider-rule">
          <div class="dr-line"/>
          <div class="dr-tabs">
            <button v-for="tab in [
              { id: 'current',  label: '01 Kondisi Saat Ini' },
              { id: 'forecast', label: '02 Prakiraan 7 Hari' },
              { id: 'air',      label: '03 Kualitas Udara' },
            ] as const"
              :key="tab.id"
              class="dr-tab"
              :class="{ 'is-active': activeTab === tab.id }"
              @click="activeTab = tab.id"
            >{{ tab.label }}</button>
          </div>
          <div class="dr-line"/>
        </div>

        <!-- ── TAB: CURRENT ────────────────────────────────────────────────── -->
        <Transition name="tab-fade" mode="out-in">
          <section v-if="activeTab === 'current'" key="current" class="tab-panel">
            <div class="current-grid">

              <!-- Detailed metrics -->
              <div class="panel-block">
                <h3 class="panel-title">Parameter Meteorologi</h3>
                <div class="metrics-list">
                  <div class="metric-row" v-for="(item, i) in [
                    { label: 'Suhu Udara',      val: `${Math.round(weatherData.current.temperature_2m)}°C`,    bar: Math.abs(weatherData.current.temperature_2m)/50 },
                    { label: 'Terasa Seperti',   val: `${Math.round(weatherData.current.apparent_temperature)}°C`, bar: Math.abs(weatherData.current.apparent_temperature)/50 },
                    { label: 'Titik Embun',      val: `${Math.round(weatherData.current.dew_point_2m)}°C`,     bar: Math.abs(weatherData.current.dew_point_2m)/50 },
                    { label: 'Kelembapan',       val: `${weatherData.current.relative_humidity_2m}%`,           bar: weatherData.current.relative_humidity_2m/100 },
                    { label: 'Tekanan Permukaan',val: `${weatherData.current.surface_pressure} hPa`,            bar: (weatherData.current.surface_pressure-950)/150 },
                    { label: 'Tutupan Awan',     val: `${weatherData.current.cloud_cover}%`,                    bar: weatherData.current.cloud_cover/100 },
                    { label: 'Presipitasi',      val: `${weatherData.current.precipitation} mm`,                bar: Math.min(weatherData.current.precipitation/30, 1) },
                    { label: 'Jarak Pandang',    val: `${(weatherData.current.visibility/1000).toFixed(1)} km`, bar: Math.min(weatherData.current.visibility/24000, 1) },
                    { label: 'Hembusan Angin',   val: `${weatherData.current.wind_gusts_10m} km/h`,             bar: Math.min(weatherData.current.wind_gusts_10m/120, 1) },
                  ]" :key="item.label" :style="`animation-delay:${i*0.045}s`">
                    <span class="mr-idx">{{ String(i+1).padStart(2,'0') }}</span>
                    <span class="mr-label">{{ item.label }}</span>
                    <div class="mr-bar-wrap">
                      <div class="mr-bar-fill" :style="{ width: `${(Math.min(item.bar, 1) * 100).toFixed(0)}%` }"/>
                    </div>
                    <span class="mr-val">{{ item.val }}</span>
                  </div>
                </div>
              </div>

              <!-- Solar cycle -->
              <div class="panel-block">
                <h3 class="panel-title">Siklus Matahari</h3>
                <div class="solar-widget">
                  <svg viewBox="0 0 280 160" class="solar-svg">
                    <defs>
                      <linearGradient id="arc-grad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stop-color="#E8A020" stop-opacity="0.3"/>
                        <stop offset="100%" stop-color="#E8A020"/>
                      </linearGradient>
                    </defs>
                    <!-- Ground line -->
                    <line x1="32" y1="130" x2="248" y2="130" stroke="var(--rule)" stroke-width="0.75"/>
                    <!-- Track arc -->
                    <path :d="`M ${SUN_CX - SUN_R} 130 A ${SUN_R} ${SUN_R} 0 0 1 ${SUN_CX + SUN_R} 130`"
                      fill="none" stroke="var(--surface-2)" stroke-width="1.5"/>
                    <!-- Progress arc -->
                    <path :d="`M ${SUN_CX - SUN_R} 130 A ${SUN_R} ${SUN_R} 0 0 1 ${SUN_CX + SUN_R} 130`"
                      fill="none" stroke="url(#arc-grad)" stroke-width="2.5" stroke-linecap="round"
                      :stroke-dasharray="sunArcLength"
                      :stroke-dashoffset="sunDashOffset"
                      class="solar-arc-fill"
                    />
                    <!-- Sun dot -->
                    <circle :cx="sunDotPos.x" :cy="sunDotPos.y" r="7" fill="var(--mood-accent)" opacity="0.25" class="sun-glow"/>
                    <circle :cx="sunDotPos.x" :cy="sunDotPos.y" r="4" fill="var(--mood-accent)" class="sun-core"/>
                    <!-- Labels -->
                    <text :x="SUN_CX - SUN_R" y="148" font-size="8" fill="var(--text-3)" text-anchor="middle" font-family="'DM Mono',monospace">{{ formatTime(weatherData.daily.sunrise[0]) }}</text>
                    <text :x="SUN_CX + SUN_R" y="148" font-size="8" fill="var(--text-3)" text-anchor="middle" font-family="'DM Mono',monospace">{{ formatTime(weatherData.daily.sunset[0]) }}</text>
                    <text :x="SUN_CX" y="88" font-size="8" fill="var(--text-3)" text-anchor="middle" font-family="'DM Mono',monospace">{{ formatDaylight(weatherData.daily.daylight_duration[0]) }}</text>
                    <!-- Terbit / Terbenam -->
                    <text :x="SUN_CX - SUN_R" y="138" font-size="6" fill="var(--mood-accent)" text-anchor="middle" font-family="'DM Mono',monospace" opacity="0.7">TERBIT</text>
                    <text :x="SUN_CX + SUN_R" y="138" font-size="6" fill="var(--mood-accent)" text-anchor="middle" font-family="'DM Mono',monospace" opacity="0.7">TERBENAM</text>
                  </svg>

                  <!-- UV row -->
                  <div class="uv-panel">
                    <div class="uv-header">
                      <span class="uv-label-text">Indeks UV Maksimum</span>
                      <div class="uv-badge" :style="{ background: uvColor(weatherData.daily.uv_index_max[0]) + '20', color: uvColor(weatherData.daily.uv_index_max[0]) }">
                        <span class="uv-val">{{ weatherData.daily.uv_index_max[0] }}</span>
                        <span class="uv-desc">{{ uvLabel(weatherData.daily.uv_index_max[0]) }}</span>
                      </div>
                    </div>
                    <div class="uv-spectrum">
                      <div class="uv-track">
                        <div class="uv-fill" :style="{ width: `${Math.min(weatherData.daily.uv_index_max[0]/11*100,100)}%`, background: uvColor(weatherData.daily.uv_index_max[0]) }"/>
                        <div class="uv-marker" :style="{ left: `${Math.min(weatherData.daily.uv_index_max[0]/11*100,100)}%`, background: uvColor(weatherData.daily.uv_index_max[0]) }"/>
                      </div>
                      <div class="uv-scale">
                        <span v-for="n in [0,2,5,7,10,11]" :key="n">{{ n }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

            </div>

            <!-- Directives -->
            <h3 class="panel-title panel-title--full">Rekomendasi &amp; Peringatan</h3>
            <div class="directives-grid">
              <div
                v-for="(d, idx) in directives"
                :key="idx"
                class="directive-card"
                :class="`directive-card--${d.severity}`"
                :style="`animation-delay:${idx * 0.06 + 0.3}s`"
              >
                <span class="dc-icon">{{ d.icon }}</span>
                <p class="dc-text">{{ d.text }}</p>
                <span class="dc-num">{{ String(idx+1).padStart(2,'0') }}</span>
              </div>
            </div>
          </section>

          <!-- ── TAB: FORECAST ──────────────────────────────────────────────── -->
          <section v-else-if="activeTab === 'forecast'" key="forecast" class="tab-panel">
            <div class="forecast-header">
              <h3 class="panel-title">Prakiraan 7 Hari ke Depan</h3>
              <span class="forecast-note">· rentang suhu hari ini: {{ Math.round(weatherData.daily.temperature_2m_min[0]) }}° – {{ Math.round(weatherData.daily.temperature_2m_max[0]) }}°</span>
            </div>
            <div class="forecast-table">
              <div
                v-for="i in 7" :key="i"
                class="forecast-row"
                :class="{ 'forecast-row--today': i === 0 }"
                :style="`animation-delay:${i*0.07}s`"
              >
                <!-- Day -->
                <div class="fr-day">
                  <span class="fr-dow">{{ getDayName(weatherData.daily.time[i]) }}</span>
                  <span class="fr-date">{{ getDateNum(weatherData.daily.time[i]) }} {{ getMonthShort(weatherData.daily.time[i]) }}</span>
                </div>

                <!-- Condition icon -->
                <div class="fr-cond">
                  <span class="fr-cond-icon" :style="{ color: 'var(--mood-accent)' }">
                    {{ [95,96,99].includes(weatherData.daily.weather_code?.[i] ?? 0) ? '⚡' :
                       [51,53,55,61,63,65,80,81,82].includes(weatherData.daily.weather_code?.[i] ?? 0) ? '◈' :
                       [1,2,3].includes(weatherData.daily.weather_code?.[i] ?? 0) ? '◐' : '◎' }}
                  </span>
                </div>

                <!-- Temp range bar -->
                <div class="fr-range">
                  <span class="fr-min">{{ Math.round(weatherData.daily.temperature_2m_min[i]) }}°</span>
                  <div class="fr-range-track">
                    <div class="fr-range-bar" :style="{
                      left:  barLeft(weatherData.daily.temperature_2m_min[i]),
                      width: barWidth(weatherData.daily.temperature_2m_min[i], weatherData.daily.temperature_2m_max[i]),
                    }"/>
                  </div>
                  <span class="fr-max">{{ Math.round(weatherData.daily.temperature_2m_max[i]) }}°</span>
                </div>

                <!-- Precip -->
                <div class="fr-precip">
                  <span class="fr-precip-icon" :class="{ 'fr-precip-icon--active': weatherData.daily.precipitation_probability_max[i] > 20 }">◈</span>
                  <span class="fr-precip-val">{{ weatherData.daily.precipitation_probability_max[i] > 0 ? weatherData.daily.precipitation_probability_max[i] + '%' : '—' }}</span>
                </div>

                <!-- Wind -->
                <div class="fr-wind">
                  <span class="fr-wind-val">{{ weatherData.daily.wind_speed_10m_max[i] }}</span>
                  <span class="fr-wind-unit">km/h</span>
                </div>

                <!-- UV -->
                <div class="fr-uv" :style="{ color: uvColor(weatherData.daily.uv_index_max[i]) }">
                  UV {{ weatherData.daily.uv_index_max[i] }}
                </div>

                <!-- Sunrise / Sunset -->
                <div class="fr-sun">
                  <span class="fr-sun-rise">↑ {{ formatTime(weatherData.daily.sunrise[i]) }}</span>
                  <span class="fr-sun-set">↓ {{ formatTime(weatherData.daily.sunset[i]) }}</span>
                </div>
              </div>
            </div>
          </section>

          <!-- ── TAB: AIR QUALITY ────────────────────────────────────────────── -->
          <section v-else-if="activeTab === 'air'" key="air" class="tab-panel">
            <div v-if="weatherData.air_quality" class="air-layout">

              <!-- Hero AQI score -->
              <div class="aqi-hero">
                <div class="aqi-score-wrap" :style="{ '--aqi-col': aqiTokens(weatherData.air_quality).fg }">
                  <svg viewBox="0 0 200 200" class="aqi-ring-svg">
                    <circle cx="100" cy="100" r="80" fill="none" stroke="var(--surface-2)" stroke-width="8"/>
                    <circle cx="100" cy="100" r="80" fill="none"
                      :stroke="aqiTokens(weatherData.air_quality).fg"
                      stroke-width="8"
                      stroke-linecap="round"
                      stroke-dasharray="502.7"
                      :stroke-dashoffset="502.7 * (1 - Math.min(weatherData.air_quality.aqi / 300, 1))"
                      transform="rotate(-90 100 100)"
                      class="aqi-ring-arc"
                    />
                    <text x="100" y="92" text-anchor="middle" font-size="48" font-weight="900" font-family="'Playfair Display',Georgia,serif" :fill="aqiTokens(weatherData.air_quality).fg">
                      {{ weatherData.air_quality.aqi }}
                    </text>
                    <text x="100" y="112" text-anchor="middle" font-size="9" font-family="'DM Mono',monospace" fill="var(--text-3)" letter-spacing="0.15em">
                      INDEKS KUALITAS
                    </text>
                    <text x="100" y="128" text-anchor="middle" font-size="10" font-family="'DM Mono',monospace" :fill="aqiTokens(weatherData.air_quality).fg" font-weight="500">
                      {{ aqiTokens(weatherData.air_quality).label.toUpperCase() }}
                    </text>
                  </svg>
                </div>
                <div class="aqi-hero-meta">
                  <p class="aqi-hero-pollutant">
                    Polutan dominan: <strong>{{ weatherData.air_quality.dominant_pollutant }}</strong>
                  </p>
                  <p class="aqi-hero-advice">
                    {{
                      weatherData.air_quality.aqi <= 50  ? 'Kualitas udara memuaskan, risiko kesehatan sangat kecil.' :
                      weatherData.air_quality.aqi <= 100 ? 'Kualitas udara dapat diterima, namun mungkin ada kekhawatiran untuk beberapa kelompok sensitif.' :
                      weatherData.air_quality.aqi <= 150 ? 'Kelompok sensitif mungkin mengalami gangguan kesehatan. Masyarakat umum umumnya tidak terpengaruh.' :
                      weatherData.air_quality.aqi <= 200 ? 'Setiap orang mungkin mulai mengalami gangguan. Kelompok sensitif lebih serius terpengaruh.' :
                      'Peringatan darurat kondisi kesehatan. Seluruh masyarakat kemungkinan terpengaruh.'
                    }}
                  </p>
                </div>
              </div>

              <!-- Pollutant bars -->
              <div class="pollutants-grid">
                <div class="pollutant-card" v-for="(item, i) in [
                  { label: 'PM2.5',    val: weatherData.air_quality.pm2_5,           unit: 'µg/m³', max: 150, safe: 12,   who: 15  },
                  { label: 'PM10',     val: weatherData.air_quality.pm10,            unit: 'µg/m³', max: 200, safe: 54,   who: 45  },
                  { label: 'Ozon (O₃)',val: weatherData.air_quality.ozone,           unit: 'µg/m³', max: 200, safe: 100,  who: 100 },
                  { label: 'NO₂',      val: weatherData.air_quality.nitrogen_dioxide,unit: 'µg/m³', max: 200, safe: 100,  who: 25  },
                ]" :key="item.label" :style="`animation-delay:${i*0.1}s`">
                  <div class="pc-header">
                    <span class="pc-label">{{ item.label }}</span>
                    <span class="pc-val" :style="{ color: aqiTokens(weatherData.air_quality!).fg }">
                      {{ item.val.toFixed(1) }}<span class="pc-unit">{{ item.unit }}</span>
                    </span>
                  </div>
                  <div class="pc-track">
                    <div class="pc-fill" :style="{
                      width: `${Math.min(item.val/item.max*100,100).toFixed(1)}%`,
                      background: aqiTokens(weatherData.air_quality!).fg,
                    }"/>
                    <!-- WHO guideline marker -->
                    <div class="pc-who-marker" :style="{ left: `${Math.min(item.who/item.max*100,100)}%` }" :title="`WHO: ${item.who} µg/m³`"/>
                  </div>
                  <div class="pc-footer">
                    <span class="pc-who-label">Batas WHO: {{ item.who }}µg/m³</span>
                    <span class="pc-ratio" :style="{ color: item.val > item.who ? '#C0392B' : '#27AE60' }">
                      {{ item.val > item.who ? '▲ Melebihi' : '✓ Aman' }}
                    </span>
                  </div>
                </div>
              </div>

            </div>
            <div v-else class="air-unavailable">
              <span>Data kualitas udara tidak tersedia untuk lokasi ini.</span>
            </div>
          </section>
        </Transition>

        <!-- ── FOOTER ──────────────────────────────────────────────────────── -->
        <footer class="site-footer">
          <div class="footer-inner">
            <div class="footer-brand">
              <span :style="{ color: 'var(--mood-accent)' }">{{ currentMoodConfig.icon }}</span>
              ATMOSFERA
            </div>
            <div class="footer-meta">
              Data: Open-Meteo API &nbsp;·&nbsp; {{ utcClock }}
            </div>
            <div class="footer-coords" v-if="weatherData">
              {{ fmtCoord(weatherData.location.latitude,'N','S') }} {{ fmtCoord(weatherData.location.longitude,'T','B') }}
            </div>
          </div>
        </footer>

      </main>
    </Transition>
  </div>
</template>

<style scoped>
/* ── Web fonts ───────────────────────────────────────────────────────────── */
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700;1,900&family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&display=swap');

/* ── Design system tokens ────────────────────────────────────────────────── */
.shell {
  /* Core palette */
  --bg:        #F4F1E8;
  --bg-alt:    #EDE9DE;
  --surface:   rgba(255,255,255,0.55);
  --surface-2: rgba(0,0,0,0.06);
  --text-1:    #1C1A16;
  --text-2:    #4A4842;
  --text-3:    #9A9690;
  --rule:      rgba(0,0,0,0.12);
  --rule-hard: rgba(0,0,0,0.22);
  --danger:    #C0392B;

  /* Defaults (overridden per mood) */
  --mood-accent: #E8A020;
  --mood-grad: radial-gradient(ellipse 120% 60% at 70% -10%, rgba(232,160,32,0.18) 0%, transparent 70%);

  /* Typography */
  --font-display: 'Playfair Display', 'Times New Roman', Georgia, serif;
  --font-mono:    'DM Mono', ui-monospace, 'Cascadia Code', monospace;

  /* Radii */
  --r-sm: 4px;
  --r-md: 8px;
  --r-lg: 14px;

  /* Shadows */
  --shadow-card: 0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.05);
  --shadow-elevated: 0 2px 8px rgba(0,0,0,0.08), 0 12px 40px rgba(0,0,0,0.08);

  font-family: var(--font-mono);
  background: var(--bg);
  color: var(--text-1);
  min-height: 100vh;
  overflow-x: hidden;
  position: relative;
  -webkit-font-smoothing: antialiased;
}

/* ── Generative background ───────────────────────────────────────────────── */
.bg-canvas {
  position: fixed; inset: 0;
  pointer-events: none; z-index: 0;
  background: var(--mood-grad);
  transition: background 1.2s ease;
}
.bg-svg { width: 100%; height: 100%; }

/* Mood animations */
.ring {
  transform-box: fill-box;
  transform-origin: center;
  animation: ring-breathe 5s ease-in-out infinite alternate;
}
@keyframes ring-breathe {
  from { transform: scale(1);    opacity: inherit; }
  to   { transform: scale(1.06); opacity: calc(inherit * 0.7); }
}
.rain-line {
  animation: rain-fall linear infinite;
  animation-duration: inherit;
}
@keyframes rain-fall {
  from { transform: translateY(-5%); }
  to   { transform: translateY(5%); }
}
.blob { animation: blob-drift ease-in-out infinite alternate; }
.blob-1 { animation-duration: 10s; }
.blob-2 { animation-duration: 13s; animation-delay: -4s; }
.blob-3 { animation-duration: 8s;  animation-delay: -2s; }
.blob-4 { animation-duration: 11s; animation-delay: -6s; }
@keyframes blob-drift {
  from { transform: translate(0,0) scale(1); }
  to   { transform: translate(25px,15px) scale(1.07); }
}
.lightning { animation: lightning-flash 3s ease-in-out infinite; }
@keyframes lightning-flash {
  0%,85%,100% { opacity: 0.05; }
  90%          { opacity: 0.22; }
  93%          { opacity: 0.08; }
  96%          { opacity: 0.18; }
}
.snowdot { animation: snow-twinkle ease-in-out infinite alternate; }
@keyframes snow-twinkle {
  from { opacity: 0.02; r: inherit; }
  to   { opacity: 0.14; r: calc(inherit * 1.5); }
}
.fog-band { animation: fog-drift ease-in-out infinite alternate; }
@keyframes fog-drift {
  from { transform: translateX(0); }
  to   { transform: translateX(30px); }
}

/* Grain texture */
.grain {
  position: fixed; inset: 0;
  pointer-events: none; z-index: 1;
  opacity: 0.022;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 200px;
  animation: grain-anim 0.1s steps(1) infinite;
}
@keyframes grain-anim {
  0%  { transform: translate(0,0); }
  25% { transform: translate(-3px, 2px); }
  50% { transform: translate(2px,-2px); }
  75% { transform: translate(3px, 3px); }
}

/* ── Top bar ─────────────────────────────────────────────────────────────── */
.topbar {
  position: sticky; top: 0; z-index: 100;
  display: flex; align-items: center; gap: 20px;
  padding: 0 40px;
  height: 64px;
  background: rgba(244,241,232,0.85);
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  border-bottom: 1px solid var(--rule);
}

.topbar-brand { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.brand-icon {
  font-size: 22px; line-height: 1;
  transition: color 0.8s ease;
}
.brand-text { display: flex; flex-direction: column; gap: 1px; }
.brand-name {
  font-family: var(--font-display);
  font-size: 18px; font-weight: 900; font-style: italic;
  letter-spacing: -0.02em; line-height: 1;
  color: var(--text-1);
}
.brand-sub {
  font-size: 9px; letter-spacing: 0.16em;
  text-transform: uppercase; color: var(--text-3);
}

.topbar-nav {
  display: flex; gap: 2px;
  margin-left: auto;
}
.nav-tab {
  background: none; border: none;
  font-family: var(--font-mono); font-size: 11px;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--text-3); cursor: pointer;
  padding: 6px 14px;
  border-radius: var(--r-sm);
  transition: all 0.18s;
}
.nav-tab:hover:not(:disabled) { color: var(--text-1); background: var(--surface-2); }
.nav-tab.is-active { color: var(--text-1); background: var(--surface-2); }
.nav-tab:disabled { opacity: 0.3; cursor: not-allowed; }

.topbar-right { display: flex; align-items: center; gap: 16px; margin-left: 20px; }

.clock-block { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
.clock-local {
  font-family: var(--font-display); font-size: 17px; font-weight: 700;
  letter-spacing: -0.02em; line-height: 1; color: var(--text-1);
}
.clock-utc { font-size: 8px; letter-spacing: 0.12em; color: var(--text-3); text-transform: uppercase; }

.search-toggle, .locate-btn-icon {
  background: none; border: 1px solid var(--rule);
  width: 36px; height: 36px;
  border-radius: var(--r-sm);
  display: flex; align-items: center; justify-content: center;
  color: var(--text-2); cursor: pointer;
  transition: all 0.18s;
}
.search-toggle:hover, .locate-btn-icon:hover:not(:disabled) {
  background: var(--surface-2); color: var(--text-1);
  border-color: var(--rule-hard);
}
.search-toggle.is-open { background: var(--text-1); color: var(--bg); border-color: var(--text-1); }
.locate-btn-icon:disabled { opacity: 0.3; cursor: not-allowed; }

/* ── Search drawer ───────────────────────────────────────────────────────── */
.search-drawer {
  position: sticky; top: 64px; z-index: 90;
  background: rgba(244,241,232,0.95);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--rule);
}
.search-inner { padding: 20px 40px; }
.search-field-wrap {
  display: flex; align-items: center;
  border: 1.5px solid var(--rule-hard);
  border-radius: var(--r-md);
  background: var(--bg);
  overflow: hidden;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.search-field-wrap.is-focused {
  border-color: var(--mood-accent);
  box-shadow: 0 0 0 3px rgba(var(--mood-accent), 0.15);
}
.search-icon { margin: 0 12px; color: var(--text-3); flex-shrink: 0; }
.search-field {
  flex: 1; background: none; border: none;
  padding: 14px 0; outline: none;
  font-family: var(--font-mono); font-size: 14px;
  color: var(--text-1); letter-spacing: 0.02em;
}
.search-field::placeholder { color: var(--text-3); }
.search-go {
  background: var(--text-1); color: var(--bg);
  border: none; padding: 14px 24px;
  font-family: var(--font-mono); font-size: 12px;
  letter-spacing: 0.1em; text-transform: uppercase;
  cursor: pointer; transition: opacity 0.15s;
}
.search-go:hover:not(:disabled) { opacity: 0.75; }
.search-go:disabled { opacity: 0.3; cursor: not-allowed; }

.drawer-history {
  display: flex; align-items: center; gap: 10px; margin-top: 14px; flex-wrap: wrap;
}
.drawer-history-label {
  font-size: 9px; letter-spacing: 0.16em;
  text-transform: uppercase; color: var(--text-3);
}
.drawer-chip {
  background: var(--surface-2); border: 1px solid var(--rule);
  padding: 4px 12px; border-radius: 999px;
  font-family: var(--font-mono); font-size: 11px;
  color: var(--text-2); cursor: pointer;
  transition: all 0.15s;
}
.drawer-chip:hover { background: var(--rule); color: var(--text-1); }
.drawer-clear {
  background: none; border: none;
  font-family: var(--font-mono); font-size: 10px;
  color: var(--danger); cursor: pointer; margin-left: auto;
  opacity: 0.6; transition: opacity 0.15s;
}
.drawer-clear:hover { opacity: 1; }

/* ── Status / error bar ──────────────────────────────────────────────────── */
.status-error {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 40px;
  background: var(--danger); color: white;
  font-size: 12px; letter-spacing: 0.04em;
  position: relative; z-index: 80;
}
.status-err-icon {
  width: 20px; height: 20px; border: 1.5px solid rgba(255,255,255,0.6);
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; flex-shrink: 0;
}
.status-dismiss {
  margin-left: auto; background: none; border: none;
  color: rgba(255,255,255,0.7); cursor: pointer; font-size: 14px;
  transition: color 0.15s;
}
.status-dismiss:hover { color: white; }

/* ── Loading stage ───────────────────────────────────────────────────────── */
.loading-stage {
  position: relative; z-index: 10;
  display: flex; flex-direction: column; align-items: center;
  padding: 120px 40px;
  gap: 20px;
}
.loader-orb { position: relative; width: 72px; height: 72px; display: flex; align-items: center; justify-content: center; }
.orb-ring {
  position: absolute; border-radius: 50%;
  border: 1.5px solid var(--mood-accent);
  animation: orb-expand 2.4s ease-out infinite;
}
.orb-ring--1 { width: 100%; height: 100%; animation-delay: 0s; }
.orb-ring--2 { width: 100%; height: 100%; animation-delay: 0.6s; }
.orb-ring--3 { width: 100%; height: 100%; animation-delay: 1.2s; }
@keyframes orb-expand {
  0%   { transform: scale(0.3); opacity: 0.8; }
  100% { transform: scale(2);   opacity: 0; }
}
.orb-core {
  position: relative; z-index: 1;
  font-size: 24px; color: var(--mood-accent);
  animation: orb-pulse 1.8s ease-in-out infinite alternate;
}
@keyframes orb-pulse { from { opacity: 0.5; } to { opacity: 1; } }
.loader-label {
  font-size: 11px; letter-spacing: 0.2em;
  text-transform: uppercase; color: var(--text-3);
}
.loader-dots { display: flex; gap: 6px; }
.dot {
  width: 4px; height: 4px; border-radius: 50%;
  background: var(--mood-accent); opacity: 0.3;
  animation: dot-bounce 0.8s ease-in-out infinite alternate;
}
@keyframes dot-bounce { from { opacity: 0.2; transform: translateY(0); } to { opacity: 1; transform: translateY(-5px); } }

/* ── Empty stage ─────────────────────────────────────────────────────────── */
.empty-stage {
  position: relative; z-index: 10;
  display: flex; flex-direction: column; align-items: center;
  padding: 100px 40px 80px;
  gap: 32px;
}
.empty-hero { text-align: center; }
.empty-icon {
  font-size: 56px; color: var(--mood-accent); opacity: 0.6;
  margin-bottom: 16px; display: block;
  animation: empty-float 4s ease-in-out infinite alternate;
}
@keyframes empty-float { from { transform: translateY(0); } to { transform: translateY(-12px); } }
.empty-title {
  font-family: var(--font-display);
  font-size: clamp(48px, 8vw, 96px);
  font-weight: 900; font-style: italic;
  letter-spacing: -0.04em; color: var(--text-1);
  line-height: 1;
}
.empty-sub {
  margin-top: 12px;
  font-size: 13px; color: var(--text-3); letter-spacing: 0.06em;
}
.empty-actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
.empty-action-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 24px;
  background: var(--text-1); color: var(--bg);
  border: none; border-radius: var(--r-md);
  font-family: var(--font-mono); font-size: 12px;
  letter-spacing: 0.08em; text-transform: uppercase;
  cursor: pointer; transition: all 0.18s;
}
.empty-action-btn:hover { opacity: 0.8; transform: translateY(-1px); }
.empty-action-btn--secondary {
  background: transparent; color: var(--text-2);
  border: 1.5px solid var(--rule-hard);
}
.empty-cities { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center; }
.empty-cities-label { font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-3); }
.city-pill {
  background: var(--surface-2); border: 1px solid var(--rule);
  padding: 5px 14px; border-radius: 999px;
  font-family: var(--font-mono); font-size: 11px;
  color: var(--text-2); cursor: pointer;
  transition: all 0.15s;
}
.city-pill:hover { background: var(--mood-accent); color: white; border-color: transparent; }

/* ── Main content wrapper ────────────────────────────────────────────────── */
.main-content {
  position: relative; z-index: 10;
  padding: 0 40px 60px;
}
.main-content > * {
  opacity: 0; transform: translateY(16px);
  transition: opacity 0.55s ease, transform 0.55s ease;
}
.main-content.is-ready > * { opacity: 1; transform: none; }
.main-content.is-ready > *:nth-child(1) { transition-delay: 0.04s; }
.main-content.is-ready > *:nth-child(2) { transition-delay: 0.10s; }
.main-content.is-ready > *:nth-child(3) { transition-delay: 0.16s; }
.main-content.is-ready > *:nth-child(4) { transition-delay: 0.22s; }
.main-content.is-ready > *:nth-child(5) { transition-delay: 0.28s; }

/* ── HERO section ────────────────────────────────────────────────────────── */
.hero {
  display: grid;
  grid-template-columns: 5fr 4fr 3fr;
  gap: 0;
  padding: 40px 0 36px;
  border-bottom: 1px solid var(--rule);
}

/* Hero location column */
.hero-location { padding-right: 40px; border-right: 1px solid var(--rule); }

.location-breadcrumb {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 14px;
  font-size: 9px; letter-spacing: 0.16em;
  text-transform: uppercase; color: var(--text-3);
}
.breadcrumb-sep { color: var(--rule-hard); }

.city-name {
  font-family: var(--font-display);
  font-size: clamp(32px, 5vw, 64px);
  font-weight: 900; line-height: 1.0;
  letter-spacing: -0.03em; color: var(--text-1);
  margin-bottom: 10px;
}

.condition-badge {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 16px;
}
.condition-icon {
  font-size: 16px;
  transition: color 0.8s ease;
}
.condition-text {
  font-size: 12px; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--text-2);
}

.alert-band {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 5px 12px; border-radius: var(--r-sm);
  font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;
  margin-bottom: 14px; font-weight: 500;
}
.alert-band--ok       { background: #E0F0E8; color: #1D6A4A; }
.alert-band--warn     { background: #FDE8DC; color: #8A3800; }
.alert-band--critical { background: #FDE0E0; color: #7A1010; }
.alert-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.alert-band--warn .alert-dot     { animation: blink-warn 1.2s ease-in-out infinite; }
.alert-band--critical .alert-dot { animation: blink-warn 0.7s ease-in-out infinite; }
@keyframes blink-warn { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }

.aqi-badge {
  display: inline-flex; align-items: center; gap: 0;
  border-radius: var(--r-md);
  overflow: hidden; margin-bottom: 20px;
}
.aqi-badge-num {
  font-family: var(--font-display);
  font-size: 28px; font-weight: 900; letter-spacing: -0.03em;
  padding: 8px 14px; line-height: 1;
}
.aqi-badge-divider { width: 1px; height: 40px; background: currentColor; opacity: 0.2; }
.aqi-badge-info { display: flex; flex-direction: column; padding: 6px 14px; gap: 2px; }
.aqi-badge-label { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600; }
.aqi-badge-poll  { font-size: 9px; opacity: 0.65; letter-spacing: 0.06em; }

/* Sparkline */
.sparkline-wrap { margin-bottom: 20px; }
.sparkline-svg { width: 100%; height: 44px; display: block; overflow: visible; }
.spark-line { stroke-dasharray: 1000; stroke-dashoffset: 1000; animation: spark-draw 1.2s ease-out 0.4s forwards; }
@keyframes spark-draw { to { stroke-dashoffset: 0; } }
.sparkline-label {
  font-size: 8px; color: var(--text-3);
  letter-spacing: 0.1em; margin-top: 4px; display: block;
}

.hero-meta {
  font-size: 9px; color: var(--text-3); letter-spacing: 0.1em;
  display: flex; gap: 6px; align-items: center;
}
.meta-sep { color: var(--rule-hard); }

/* Hero temp block */
.hero-temp-block {
  display: flex; flex-direction: column;
  justify-content: center; align-items: center;
  padding: 0 32px;
  border-right: 1px solid var(--rule);
}

.temp-mega {
  display: flex; align-items: flex-start;
  line-height: 1;
}
.temp-number {
  font-family: var(--font-display);
  font-size: clamp(88px, 14vw, 164px);
  font-weight: 900; font-style: italic;
  letter-spacing: -0.06em;
  color: var(--text-1);
  animation: temp-appear 0.8s cubic-bezier(0.16,1,0.3,1) both;
}
@keyframes temp-appear {
  from { opacity: 0; transform: scale(0.85) translateY(20px); }
  to   { opacity: 1; transform: none; }
}
.temp-meta-col {
  display: flex; flex-direction: column;
  margin-left: 6px; margin-top: 14px;
  gap: 4px;
}
.temp-deg {
  font-family: var(--font-display);
  font-size: clamp(20px, 3vw, 36px);
  font-weight: 400; font-style: italic;
  color: var(--text-3); line-height: 1;
}
.temp-feel { font-size: 10px; color: var(--text-3); letter-spacing: 0.08em; }
.temp-range { font-size: 10px; color: var(--mood-accent); letter-spacing: 0.04em; font-weight: 500; }

/* Gauge */
.gauge-wrap { width: 140px; margin-top: 12px; }
.gauge-svg { width: 100%; overflow: visible; }
.gauge-arc { transition: stroke-dashoffset 1.2s cubic-bezier(0.16,1,0.3,1) 0.3s; }

/* Hero stats */
.hero-stats {
  display: flex; flex-direction: column; gap: 0;
  padding-left: 28px;
}
.stat-card {
  padding: 14px 0; border-bottom: 1px solid var(--rule);
  animation: stat-slide 0.45s ease-out calc(var(--i) * 0.08s + 0.1s) both;
}
.stat-card:last-child { border-bottom: none; }
@keyframes stat-slide {
  from { opacity: 0; transform: translateX(12px); }
  to   { opacity: 1; transform: none; }
}
.sc-header { display: flex; align-items: center; gap: 7px; margin-bottom: 6px; }
.sc-icon { font-size: 13px; transition: color 0.8s ease; }
.sc-label { font-size: 8px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-3); }
.sc-value { display: flex; align-items: baseline; gap: 4px; margin-bottom: 3px; }
.sc-num {
  font-family: var(--font-display); font-size: 28px; font-weight: 700;
  letter-spacing: -0.03em; color: var(--text-1); line-height: 1;
}
.sc-unit { font-size: 10px; color: var(--text-3); letter-spacing: 0.06em; }
.sc-sub { font-size: 8px; color: var(--text-3); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px; }
.sc-bar-track { height: 2px; background: var(--surface-2); border-radius: 1px; overflow: hidden; }
.sc-bar-fill { height: 100%; background: var(--mood-accent); border-radius: 1px; transition: width 1s cubic-bezier(0.16,1,0.3,1) 0.5s; }

/* ── Divider rule with tabs ───────────────────────────────────────────────── */
.divider-rule {
  display: flex; align-items: center; gap: 0;
  margin: 28px 0 0;
  border-top: 2px solid var(--text-1);
  padding-top: 8px;
}
.dr-line { flex: 1; }
.dr-tabs { display: flex; gap: 0; }
.dr-tab {
  background: none; border: none; border-bottom: 2px solid transparent;
  margin-bottom: -10px; padding: 8px 20px;
  font-family: var(--font-mono); font-size: 10px;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--text-3); cursor: pointer;
  transition: all 0.18s;
}
.dr-tab:hover { color: var(--text-2); }
.dr-tab.is-active { color: var(--text-1); border-bottom-color: var(--mood-accent); }

/* ── Tab panel ───────────────────────────────────────────────────────────── */
.tab-panel { padding: 32px 0; }

/* ── CURRENT tab ─────────────────────────────────────────────────────────── */
.current-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 40px; margin-bottom: 36px;
}

.panel-block { }
.panel-title {
  font-size: 8px; font-weight: 400;
  letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--text-3); margin-bottom: 18px;
  padding-bottom: 8px; border-bottom: 1px solid var(--rule);
}
.panel-title--full { margin-top: 8px; }

.metrics-list { display: flex; flex-direction: column; }
.metric-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 0; border-bottom: 1px solid var(--rule);
  animation: row-in 0.4s ease-out both;
}
.metric-row:last-child { border-bottom: none; }
@keyframes row-in {
  from { opacity: 0; transform: translateX(-10px); }
  to   { opacity: 1; transform: none; }
}
.mr-idx   { font-size: 8px; color: var(--text-3); width: 18px; flex-shrink: 0; letter-spacing: 0.05em; }
.mr-label { font-size: 11px; color: var(--text-2); letter-spacing: 0.03em; width: 130px; flex-shrink: 0; }
.mr-bar-wrap {
  flex: 1; height: 1.5px;
  background: var(--surface-2); position: relative; overflow: hidden;
}
.mr-bar-fill {
  position: absolute; left: 0; top: 0; height: 100%;
  background: var(--mood-accent); opacity: 0.7;
  transition: width 1s cubic-bezier(0.16,1,0.3,1);
}
.mr-val {
  font-family: var(--font-display); font-size: 15px; font-weight: 700;
  color: var(--text-1); letter-spacing: -0.02em;
  min-width: 80px; text-align: right;
}

/* Solar widget */
.solar-widget { }
.solar-svg { width: 100%; color: var(--text-1); }
.solar-arc-fill { transition: stroke-dashoffset 1.4s cubic-bezier(0.16,1,0.3,1) 0.2s; }
.sun-glow { animation: sun-breathe 2.5s ease-in-out infinite alternate; }
.sun-core { animation: sun-breathe 2.5s ease-in-out infinite alternate; animation-delay: 0.3s; }
@keyframes sun-breathe { from { r: 4; } to { r: 5.5; } }

.uv-panel { margin-top: 8px; }
.uv-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.uv-label-text { font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-3); }
.uv-badge {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 12px; border-radius: var(--r-sm);
}
.uv-val { font-family: var(--font-display); font-size: 18px; font-weight: 900; letter-spacing: -0.02em; line-height: 1; }
.uv-desc { font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 500; }
.uv-spectrum { }
.uv-track {
  height: 4px; background: var(--surface-2);
  border-radius: 2px; overflow: visible; position: relative; margin-bottom: 4px;
}
.uv-fill {
  height: 100%; border-radius: 2px;
  transition: width 1.2s cubic-bezier(0.16,1,0.3,1) 0.3s;
}
.uv-marker {
  position: absolute; top: 50%; transform: translate(-50%, -50%);
  width: 10px; height: 10px; border-radius: 50%;
  border: 2px solid white;
  transition: left 1.2s cubic-bezier(0.16,1,0.3,1) 0.3s;
  box-shadow: 0 1px 4px rgba(0,0,0,0.2);
}
.uv-scale {
  display: flex; justify-content: space-between;
  font-size: 8px; color: var(--text-3); letter-spacing: 0.04em;
}

/* Directives */
.directives-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0;
  border: 1px solid var(--rule);
  border-radius: var(--r-lg);
  overflow: hidden;
}
.directive-card {
  padding: 20px 20px 18px;
  border-right: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  display: flex; flex-direction: column; gap: 10px;
  animation: dir-in 0.4s ease-out both;
  position: relative;
  transition: background 0.2s;
  background: var(--surface);
}
.directive-card:hover { background: var(--bg-alt); }
@keyframes dir-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: none; }
}
.directive-card--critical { border-left: 3px solid #C0392B; }
.directive-card--warn     { border-left: 3px solid #E07020; }
.directive-card--info     { border-left: 3px solid var(--mood-accent); }
.dc-icon { font-size: 22px; line-height: 1; }
.dc-text {
  font-size: 12px; color: var(--text-1);
  line-height: 1.65; letter-spacing: 0.01em; flex: 1;
}
.dc-num {
  font-family: var(--font-display);
  font-size: 36px; font-weight: 900; font-style: italic;
  color: var(--rule); letter-spacing: -0.05em;
  line-height: 1; align-self: flex-end;
}

/* ── FORECAST tab ────────────────────────────────────────────────────────── */
.forecast-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 20px; }
.forecast-note { font-size: 9px; color: var(--text-3); letter-spacing: 0.08em; }

.forecast-table { display: flex; flex-direction: column; border: 1px solid var(--rule); border-radius: var(--r-lg); overflow: hidden; }
.forecast-row {
  display: grid;
  grid-template-columns: 80px 32px 1fr 80px 80px 60px 120px;
  align-items: center; gap: 16px;
  padding: 18px 24px;
  border-bottom: 1px solid var(--rule);
  animation: row-in 0.4s ease-out both;
  background: var(--surface);
  transition: background 0.18s;
}
.forecast-row:last-child { border-bottom: none; }
.forecast-row:hover { background: var(--bg-alt); }
.forecast-row--today { background: rgba(var(--mood-accent), 0.04); }

.fr-day { display: flex; flex-direction: column; gap: 1px; }
.fr-dow {
  font-family: var(--font-display); font-size: 15px; font-weight: 700;
  color: var(--text-1); letter-spacing: -0.01em; text-transform: capitalize;
}
.fr-date { font-size: 9px; color: var(--text-3); letter-spacing: 0.04em; }

.fr-cond { display: flex; align-items: center; justify-content: center; }
.fr-cond-icon { font-size: 16px; transition: color 0.8s ease; }

.fr-range { display: flex; align-items: center; gap: 10px; }
.fr-min  { font-size: 12px; color: var(--text-3); min-width: 28px; text-align: right; }
.fr-max  { font-family: var(--font-display); font-size: 16px; font-weight: 700; color: var(--text-1); min-width: 32px; }
.fr-range-track { flex: 1; height: 3px; background: var(--surface-2); border-radius: 2px; position: relative; }
.fr-range-bar {
  position: absolute; height: 100%;
  background: var(--mood-accent); border-radius: 2px; opacity: 0.7;
  transition: left 0.8s ease, width 0.8s ease;
}

.fr-precip { display: flex; align-items: center; gap: 5px; }
.fr-precip-icon { font-size: 10px; color: var(--text-3); transition: color 0.2s; }
.fr-precip-icon--active { color: #4A90C4; }
.fr-precip-val { font-size: 11px; color: var(--text-2); min-width: 32px; letter-spacing: 0.04em; }

.fr-wind { display: flex; align-items: baseline; gap: 3px; }
.fr-wind-val { font-family: var(--font-display); font-size: 16px; font-weight: 700; color: var(--text-1); letter-spacing: -0.02em; }
.fr-wind-unit { font-size: 8px; color: var(--text-3); letter-spacing: 0.06em; }

.fr-uv { font-size: 10px; letter-spacing: 0.06em; font-weight: 500; }

.fr-sun { display: flex; flex-direction: column; gap: 3px; align-items: flex-end; }
.fr-sun-rise, .fr-sun-set { font-size: 10px; color: var(--text-3); letter-spacing: 0.06em; }

/* ── AIR QUALITY tab ─────────────────────────────────────────────────────── */
.air-layout { display: flex; flex-direction: column; gap: 36px; }
.aqi-hero {
  display: flex; align-items: center; gap: 40px;
  padding: 32px; background: var(--surface);
  border: 1px solid var(--rule); border-radius: var(--r-lg);
}
.aqi-score-wrap { flex-shrink: 0; }
.aqi-ring-svg { width: 180px; height: 180px; }
.aqi-ring-arc { transition: stroke-dashoffset 1.4s cubic-bezier(0.16,1,0.3,1) 0.3s; }

.aqi-hero-meta { flex: 1; }
.aqi-hero-pollutant {
  font-size: 12px; color: var(--text-2);
  letter-spacing: 0.04em; margin-bottom: 12px;
}
.aqi-hero-pollutant strong { color: var(--text-1); }
.aqi-hero-advice {
  font-size: 14px; color: var(--text-1);
  line-height: 1.7; letter-spacing: 0.01em;
}

.pollutants-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.pollutant-card {
  padding: 24px; background: var(--surface);
  border: 1px solid var(--rule); border-radius: var(--r-lg);
  animation: row-in 0.4s ease-out both;
  transition: background 0.2s, box-shadow 0.2s;
}
.pollutant-card:hover {
  background: var(--bg-alt);
  box-shadow: var(--shadow-card);
}
.pc-header { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 14px; }
.pc-label { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-3); }
.pc-val { font-family: var(--font-display); font-size: 28px; font-weight: 900; letter-spacing: -0.03em; line-height: 1; }
.pc-unit { font-family: var(--font-mono); font-size: 10px; color: var(--text-3); font-weight: 300; margin-left: 3px; }
.pc-track {
  height: 4px; background: var(--surface-2); border-radius: 2px;
  position: relative; overflow: visible; margin-bottom: 8px;
}
.pc-fill {
  height: 100%; border-radius: 2px; opacity: 0.75;
  transition: width 1.2s cubic-bezier(0.16,1,0.3,1) 0.2s;
}
.pc-who-marker {
  position: absolute; top: -3px; transform: translateX(-50%);
  width: 2px; height: 10px; background: var(--text-3);
  border-radius: 1px;
}
.pc-footer { display: flex; justify-content: space-between; align-items: center; }
.pc-who-label { font-size: 9px; color: var(--text-3); letter-spacing: 0.06em; }
.pc-ratio { font-size: 10px; letter-spacing: 0.06em; font-weight: 600; }

.air-unavailable {
  padding: 60px; text-align: center;
  font-size: 13px; color: var(--text-3);
}

/* ── Footer ──────────────────────────────────────────────────────────────── */
.site-footer {
  margin-top: 60px; padding-top: 20px;
  border-top: 2px solid var(--text-1);
}
.footer-inner {
  display: flex; align-items: center;
  gap: 20px; flex-wrap: wrap;
}
.footer-brand {
  font-family: var(--font-display);
  font-size: 15px; font-weight: 900; font-style: italic;
  letter-spacing: -0.02em; color: var(--text-1);
  display: flex; align-items: center; gap: 8px;
}
.footer-meta {
  font-size: 9px; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--text-3);
}
.footer-coords {
  margin-left: auto;
  font-size: 9px; letter-spacing: 0.1em; color: var(--text-3);
}

/* ── Transition definitions ──────────────────────────────────────────────── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.35s ease; }
.fade-enter-from,   .fade-leave-to     { opacity: 0; }

.drawer-enter-active { transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.16,1,0.3,1); }
.drawer-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.drawer-enter-from   { opacity: 0; transform: translateY(-8px); }
.drawer-leave-to     { opacity: 0; transform: translateY(-4px); }

.status-bar-enter-active { animation: drop-in 0.3s cubic-bezier(0.16,1,0.3,1); }
.status-bar-leave-active { animation: drop-in 0.2s ease reverse; }
@keyframes drop-in { from { opacity: 0; transform: translateY(-100%); } to { opacity: 1; transform: none; } }

.page-reveal-enter-active { animation: page-in 0.7s cubic-bezier(0.16,1,0.3,1); }
@keyframes page-in { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }

.tab-fade-enter-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.tab-fade-leave-active { transition: opacity 0.15s ease; }
.tab-fade-enter-from   { opacity: 0; transform: translateY(8px); }
.tab-fade-leave-to     { opacity: 0; }

.spin { display: inline-block; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Responsive ──────────────────────────────────────────────────────────── */
@media (max-width: 1100px) {
  .hero { grid-template-columns: 3fr 3fr 2fr; }
}
@media (max-width: 900px) {
  .hero { grid-template-columns: 1fr 1fr; }
  .hero-stats { display: none; }
  .current-grid { grid-template-columns: 1fr; }
  .pollutants-grid { grid-template-columns: 1fr; }
  .forecast-row { grid-template-columns: 70px 28px 1fr 60px 60px; }
  .fr-uv, .fr-sun { display: none; }
}
@media (max-width: 720px) {
  .topbar { padding: 0 20px; }
  .topbar-nav { display: none; }
  .main-content { padding: 0 20px 48px; }
  .hero { grid-template-columns: 1fr; padding: 24px 0; }
  .hero-location { padding-right: 0; border-right: none; border-bottom: 1px solid var(--rule); padding-bottom: 24px; margin-bottom: 24px; }
  .hero-temp-block { border-right: none; padding: 0; }
  .temp-number { font-size: 96px; }
  .city-name { font-size: 36px; }
  .aqi-hero { flex-direction: column; text-align: center; }
  .forecast-row { grid-template-columns: 60px 24px 1fr 60px; gap: 10px; padding: 14px 16px; }
  .fr-wind, .fr-uv, .fr-sun { display: none; }
  .dr-tabs { overflow-x: auto; }
}
@media (max-width: 480px) {
  .search-inner { padding: 16px 20px; }
  .status-error { padding: 10px 20px; }
  .directives-grid { grid-template-columns: 1fr; }
  .pollutants-grid { grid-template-columns: 1fr; }
}
</style>