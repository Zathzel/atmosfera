<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import {
  getWeatherByCity,
  getWeatherByCoords,
  describeWeatherCode,
  type WeatherData,
  type AirQuality,
} from './services/weather'

// ─── State ────────────────────────────────────────────────────────────────────

const searchQuery   = ref('')
const weatherData   = ref<WeatherData | null>(null)
const isLoading     = ref(false)
const errorMsg      = ref('')
const searchHistory = ref<string[]>([])
const utcClock      = ref('--:--:-- UTC')
const displayTemp   = ref(0)       // animated counter
const hasLoaded     = ref(false)   // triggers entrance animation
const bgMood        = ref<'clear' | 'cloudy' | 'rain' | 'storm' | 'cold'>('clear')

let clockTimer:   ReturnType<typeof setInterval>
let tempAnimTimer: ReturnType<typeof setTimeout>

// ─── Clock ────────────────────────────────────────────────────────────────────

function tickClock() {
  const now = new Date()
  utcClock.value = [
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join(':') + ' UTC'
}

// ─── Animated temperature counter ────────────────────────────────────────────

function animateTemp(target: number) {
  clearTimeout(tempAnimTimer)
  const start   = displayTemp.value
  const diff    = target - start
  const steps   = 30
  const delay   = 600 // ms before animation starts
  let   step    = 0

  setTimeout(() => {
    const tick = () => {
      step++
      const progress  = step / steps
      const eased     = 1 - Math.pow(1 - progress, 3) // ease-out cubic
      displayTemp.value = Math.round(start + diff * eased)
      if (step < steps) tempAnimTimer = setTimeout(tick, 16)
    }
    tick()
  }, delay)
}

// ─── Background mood ─────────────────────────────────────────────────────────

function deriveMood(data: WeatherData) {
  const code = data.current.weather_code
  const temp = data.current.temperature_2m
  if ([95, 96, 99].includes(code))                         return 'storm'
  if ([51,53,55,61,63,65,80,81,82].includes(code))         return 'rain'
  if ([2, 3, 45, 48].includes(code))                       return 'cloudy'
  if (temp <= 5)                                            return 'cold'
  return 'clear'
}

// ─── History ──────────────────────────────────────────────────────────────────

function loadHistory() {
  try { searchHistory.value = JSON.parse(localStorage.getItem('atm_history') || '[]') }
  catch { searchHistory.value = [] }
}
function addToHistory(name: string) {
  const next = [name, ...searchHistory.value.filter(c => c.toLowerCase() !== name.toLowerCase())].slice(0, 5)
  searchHistory.value = next
  localStorage.setItem('atm_history', JSON.stringify(next))
}
function clearHistory() {
  searchHistory.value = []
  localStorage.removeItem('atm_history')
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function runFetch(fn: () => Promise<WeatherData>) {
  isLoading.value   = true
  errorMsg.value    = ''
  hasLoaded.value   = false
  weatherData.value = null
  try {
    const data = await fn()
    weatherData.value = data
    bgMood.value      = deriveMood(data)
    addToHistory(data.location.name)
    animateTemp(Math.round(data.current.temperature_2m))
    setTimeout(() => { hasLoaded.value = true }, 50)
  } catch (e: any) {
    errorMsg.value = e.message || 'Terjadi kesalahan jaringan.'
  } finally {
    isLoading.value = false
  }
}

function handleSearch() {
  if (!searchQuery.value.trim()) return
  runFetch(() => getWeatherByCity(searchQuery.value))
}
function handleChipSearch(city: string) {
  searchQuery.value = city
  runFetch(() => getWeatherByCity(city))
}
async function autoLocate() {
  if (!navigator.geolocation) { errorMsg.value = 'Geolokasi tidak tersedia.'; return }
  isLoading.value = true
  errorMsg.value  = ''
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => runFetch(() => getWeatherByCoords(coords.latitude, coords.longitude)),
    () => { errorMsg.value = 'Akses lokasi ditolak.'; isLoading.value = false },
  )
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => {
  loadHistory(); tickClock()
  clockTimer = setInterval(tickClock, 1000)
  autoLocate()
})
onUnmounted(() => { clearInterval(clockTimer); clearTimeout(tempAnimTimer) })

// ─── Computed helpers ─────────────────────────────────────────────────────────

const conditionStatus = computed<'ok' | 'warn'>(() => {
  if (!weatherData.value) return 'ok'
  const { temperature_2m, wind_speed_10m } = weatherData.value.current
  return temperature_2m > 35 || temperature_2m < 5 || wind_speed_10m > 30 ? 'warn' : 'ok'
})

const conditionLabel = computed(() => {
  if (!weatherData.value) return ''
  const { temperature_2m, wind_speed_10m } = weatherData.value.current
  if (temperature_2m > 35)  return 'Panas Ekstrem'
  if (temperature_2m < 5)   return 'Suhu Kritis'
  if (wind_speed_10m > 30)  return 'Angin Kencang'
  return 'Kondisi Normal'
})

function degToCompass(deg: number): string {
  return ['U','TL','T','TG','S','BD','B','BL'][Math.round(deg / 45) % 8]
}

const AQI_COLOR_MAP: Record<string, string> = {
  ok: 'var(--c-ok-fg)', fair: 'var(--c-fair-fg)', warn: 'var(--c-warn-fg)',
  poor: 'var(--c-poor-fg)', danger: 'var(--c-danger-fg)', hazard: 'var(--c-hazard-fg)',
}
const AQI_BG_MAP: Record<string, string> = {
  ok: 'var(--c-ok-bg)', fair: 'var(--c-fair-bg)', warn: 'var(--c-warn-bg)',
  poor: 'var(--c-poor-bg)', danger: 'var(--c-danger-bg)', hazard: 'var(--c-hazard-bg)',
}
function aqiColor(aq: AirQuality) { return AQI_COLOR_MAP[aq.aqi_color] ?? 'var(--c-text-2)' }
function aqiBg(aq: AirQuality)    { return AQI_BG_MAP[aq.aqi_color]   ?? 'transparent' }

const directives = computed(() => {
  if (!weatherData.value) return []
  const c = weatherData.value.current
  const d = weatherData.value.daily
  const aq = weatherData.value.air_quality
  const list: string[] = []
  if (c.temperature_2m <= 15)       list.push('Suhu rendah — pakaian berlapis disarankan')
  if (c.temperature_2m >= 32)       list.push('Suhu tinggi — jaga hidrasi, hindari paparan siang hari')
  if (c.wind_speed_10m >= 20)       list.push(`Angin ${degToCompass(c.wind_direction_10m)} ${c.wind_speed_10m} km/h — amankan objek di luar`)
  if (c.wind_gusts_10m >= 40)       list.push(`Hembusan hingga ${c.wind_gusts_10m} km/h — hindari tempat tinggi`)
  if (d.uv_index_max[0] >= 7)       list.push('UV tinggi — tabir surya SPF 50+ wajib dipakai')
  if (c.precipitation > 0)          list.push('Hujan aktif — siapkan jas hujan atau payung')
  if (c.visibility < 1000)          list.push(`Jarak pandang ${c.visibility} m — berkendara ekstra hati-hati`)
  if (c.relative_humidity_2m >= 85) list.push('Kelembapan ekstrem — risiko heat stress meningkat')
  if (aq && aq.aqi > 60)            list.push(`Udara ${aq.aqi_label.toLowerCase()} (AQI ${aq.aqi}) — batasi aktivitas luar ruang`)
  if (list.length === 0)            list.push('Semua parameter normal — kondisi ideal untuk aktivitas luar')
  return list
})

const forecastRange = computed(() => {
  if (!weatherData.value) return { min: 0, range: 1 }
  const mins = weatherData.value.daily.temperature_2m_min.slice(0, 6)
  const maxs = weatherData.value.daily.temperature_2m_max.slice(0, 6)
  const min = Math.min(...mins), max = Math.max(...maxs)
  return { min, range: max - min || 1 }
})

function barLeft(t: number)  { return `${(((t - forecastRange.value.min) / forecastRange.value.range) * 20).toFixed(1)}%` }
function barWidth(t: number) { return `${(((t - forecastRange.value.min) / forecastRange.value.range) * 60 + 20).toFixed(1)}%` }

function getDayName(d: string)  { return new Date(d).toLocaleDateString('id-ID', { weekday: 'short' }).toUpperCase() }
function getFullDay(d: string)  { return new Date(d).toLocaleDateString('id-ID', { weekday: 'long' }) }
function formatTime(d: string)  { return new Date(d).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }) }
function formatDaylight(s: number) { return `${Math.floor(s/3600)}j ${Math.floor((s%3600)/60)}m` }
function fmtCoord(n: number, p: string, neg: string) { return `${Math.abs(n).toFixed(4)}° ${n >= 0 ? p : neg}` }

// UV color scale
function uvColor(uv: number): string {
  if (uv <= 2)  return '#4CAF50'
  if (uv <= 5)  return '#FFC107'
  if (uv <= 7)  return '#FF9800'
  if (uv <= 10) return '#F44336'
  return '#9C27B0'
}

// Sun arc position — maps current time between sunrise/sunset to arc progress (0–1)
const sunProgress = computed(() => {
  if (!weatherData.value) return 0
  const now     = Date.now()
  const rise    = new Date(weatherData.value.daily.sunrise[0]).getTime()
  const set     = new Date(weatherData.value.daily.sunset[0]).getTime()
  if (now <= rise) return 0
  if (now >= set)  return 1
  return (now - rise) / (set - rise)
})

// Convert arc progress to SVG coordinate on the semicircle
const sunDotX = computed(() => {
  const angle = Math.PI - sunProgress.value * Math.PI   // π → 0
  return 130 + 110 * Math.cos(angle)
})
const sunDotY = computed(() => {
  const angle = Math.PI - sunProgress.value * Math.PI
  return 130 - 110 * Math.sin(angle)
})
</script>

<template>
  <div class="shell" :data-mood="bgMood">

    <!-- ── Generative background ──────────────────────────────────────────── -->
    <div class="bg-canvas" aria-hidden="true">
      <svg class="bg-svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <!-- CLEAR: concentric breath rings -->
        <g v-if="bgMood === 'clear'" class="mood-clear">
          <circle v-for="i in 12" :key="i" :r="i * 60" cx="960" cy="120" fill="none" stroke="currentColor"
            :stroke-width="i % 3 === 0 ? 0.8 : 0.3" :opacity="0.4 - i * 0.028"
            :style="`animation-delay: ${i * 0.18}s`" class="ring" />
        </g>
        <!-- RAIN: diagonal hatch lines -->
        <g v-if="bgMood === 'rain'" class="mood-rain">
          <line v-for="i in 30" :key="i"
            :x1="-100 + i * 50" y1="0" :x2="-300 + i * 50" y2="800"
            stroke="currentColor" :stroke-width="i % 4 === 0 ? 1 : 0.4"
            :opacity="0.08 + (i % 3) * 0.04"
            :style="`animation-delay: ${i * 0.07}s`" class="rain-line" />
        </g>
        <!-- CLOUDY: organic blobs -->
        <g v-if="bgMood === 'cloudy'" class="mood-cloudy">
          <ellipse cx="200" cy="150" rx="280" ry="120" fill="none" stroke="currentColor" stroke-width="0.6" opacity="0.15" class="blob blob-1"/>
          <ellipse cx="900" cy="600" rx="320" ry="140" fill="none" stroke="currentColor" stroke-width="0.6" opacity="0.12" class="blob blob-2"/>
          <ellipse cx="600" cy="350" rx="200" ry="90" fill="none" stroke="currentColor" stroke-width="0.4" opacity="0.1" class="blob blob-3"/>
        </g>
        <!-- STORM: zigzag lines -->
        <g v-if="bgMood === 'storm'" class="mood-storm">
          <polyline v-for="i in 8" :key="i"
            :points="`${i*150},0 ${i*150 - 60},400 ${i*150 + 40},400 ${i*150 - 20},800`"
            fill="none" stroke="currentColor" :stroke-width="i % 2 === 0 ? 1 : 0.4"
            :opacity="0.07 + (i % 3) * 0.04"
            :style="`animation-delay: ${i * 0.15}s`" class="lightning"/>
        </g>
        <!-- COLD: grid of dots -->
        <g v-if="bgMood === 'cold'" class="mood-cold">
          <circle v-for="i in 200" :key="i"
            :cx="(i % 20) * 65 + 10" :cy="Math.floor(i / 20) * 65 + 10"
            r="1.5" fill="currentColor"
            :opacity="0.04 + (i % 7) * 0.015"
            :style="`animation-delay: ${(i % 13) * 0.12}s`" class="snowdot"/>
        </g>
        <!-- Always: large editorial serif watermark -->
        <text x="50%" y="105%" dominant-baseline="auto" text-anchor="middle"
          class="bg-watermark" fill="currentColor" opacity="0.035" font-size="380">
          {{ weatherData ? Math.round(weatherData.current.temperature_2m) : '—' }}
        </text>
      </svg>
    </div>

    <!-- ── Grain overlay ──────────────────────────────────────────────────── -->
    <div class="grain" aria-hidden="true" />

    <!-- ── Masthead ───────────────────────────────────────────────────────── -->
    <header class="masthead">
      <div class="masthead-left">
        <div class="issue-info">
          <span class="issue-label">Vol. I</span>
          <span class="issue-sep">·</span>
          <span class="issue-label">{{ utcClock }}</span>
        </div>
        <h1 class="masthead-title">ATMOSFERA</h1>
        <p class="masthead-sub">Laporan Cuaca &amp; Kualitas Udara</p>
      </div>
      <div class="masthead-right">
        <div class="search-block">
          <input
            v-model="searchQuery"
            class="search-inp"
            type="text"
            placeholder="Kota…"
            :disabled="isLoading"
            @keydown.enter="handleSearch"
          />
          <button class="search-btn" :disabled="isLoading || !searchQuery.trim()" @click="handleSearch">
            <span v-if="!isLoading">→</span>
            <span v-else class="spin">◌</span>
          </button>
        </div>
        <button class="locate-btn" :disabled="isLoading" @click="autoLocate">
          <svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/></svg>
          Lokasi Otomatis
        </button>
      </div>
    </header>

    <!-- Masthead rule -->
    <div class="masthead-rule">
      <div class="rule-thick"/>
      <div class="rule-thin"/>
    </div>

    <!-- ── History row ────────────────────────────────────────────────────── -->
    <div v-if="searchHistory.length" class="history-bar">
      <span class="history-label">Terakhir:</span>
      <button v-for="city in searchHistory" :key="city" class="history-btn" @click="handleChipSearch(city)">{{ city }}</button>
      <button class="history-clear" @click="clearHistory">hapus</button>
    </div>

    <!-- ── Error ──────────────────────────────────────────────────────────── -->
    <Transition name="drop">
      <div v-if="errorMsg" class="error-strip" role="alert">
        <span class="error-flag">!</span> {{ errorMsg }}
      </div>
    </Transition>

    <!-- ── Loading ────────────────────────────────────────────────────────── -->
    <Transition name="fade">
      <div v-if="isLoading" class="loading-wrap">
        <div class="loading-ticker">
          <span v-for="n in 6" :key="n" class="ticker-char" :style="`animation-delay:${n*0.08}s`">·</span>
          <span class="ticker-text">Mengambil data</span>
          <span v-for="n in 6" :key="`b${n}`" class="ticker-char" :style="`animation-delay:${(6+n)*0.08}s`">·</span>
        </div>
      </div>
    </Transition>

    <!-- ── Empty ──────────────────────────────────────────────────────────── -->
    <Transition name="fade">
      <div v-if="!isLoading && !weatherData && !errorMsg" class="empty-page">
        <div class="empty-dashes">— — —</div>
        <p class="empty-instruction">Masukkan nama kota di atas atau aktifkan lokasi otomatis</p>
        <div class="empty-rule"/>
      </div>
    </Transition>

    <!-- ══════════════════════════════════════════════════════════════════════
         MAIN CONTENT
    ══════════════════════════════════════════════════════════════════════════ -->
    <Transition name="page-in">
      <main v-if="weatherData && !isLoading" class="content" :class="{ 'is-ready': hasLoaded }">

        <!-- ── FRONT PAGE: hero ────────────────────────────────────────────── -->
        <section class="front">

          <!-- Column A: location headline -->
          <div class="front-col front-col--location">
            <div class="col-rule col-rule--right" />
            <div class="eyebrow">
              <span>{{ weatherData.location.country }}</span>
              <span class="eyebrow-sep">·</span>
              <span>{{ fmtCoord(weatherData.location.latitude, 'N', 'S') }}</span>
              <span class="eyebrow-sep">·</span>
              <span>{{ fmtCoord(weatherData.location.longitude, 'E', 'W') }}</span>
            </div>
            <h2 class="city-headline">{{ weatherData.location.name }}</h2>
            <p class="city-desc">{{ describeWeatherCode(weatherData.current.weather_code) }}</p>

            <!-- Status band -->
            <div class="status-band" :class="`status-band--${conditionStatus}`">
              <span class="status-band-dot"/>
              {{ conditionLabel }}
            </div>

            <!-- AQI pill -->
            <div v-if="weatherData.air_quality" class="aqi-pill"
              :style="{ background: aqiBg(weatherData.air_quality), color: aqiColor(weatherData.air_quality) }">
              <span class="aqi-num">{{ weatherData.air_quality.aqi }}</span>
              <span class="aqi-sep"/>
              <span class="aqi-label">AQI · {{ weatherData.air_quality.aqi_label }}</span>
              <span class="aqi-poll">{{ weatherData.air_quality.dominant_pollutant }}</span>
            </div>

            <!-- Dateline -->
            <div class="dateline">
              Diperbarui {{ new Date(weatherData.fetched_at).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' }) }}
              &nbsp;·&nbsp;
              Open-Meteo
            </div>
          </div>

          <!-- Column B: giant temperature -->
          <div class="front-col front-col--temp">
            <div class="temp-super">
              <span class="temp-digits">{{ displayTemp }}</span>
              <span class="temp-deg">°C</span>
            </div>
            <div class="temp-feels">
              Terasa {{ Math.round(weatherData.current.apparent_temperature) }}°
            </div>
          </div>

          <!-- Column C: quick stats vertical strip -->
          <div class="front-col front-col--stats">
            <div class="quick-stat">
              <span class="qs-val">{{ weatherData.current.wind_speed_10m }}</span>
              <span class="qs-unit">km/h</span>
              <span class="qs-label">Angin {{ degToCompass(weatherData.current.wind_direction_10m) }}</span>
            </div>
            <div class="qs-divider"/>
            <div class="quick-stat">
              <span class="qs-val">{{ weatherData.current.relative_humidity_2m }}</span>
              <span class="qs-unit">%</span>
              <span class="qs-label">Kelembapan</span>
            </div>
            <div class="qs-divider"/>
            <div class="quick-stat">
              <span class="qs-val">{{ (weatherData.current.visibility / 1000).toFixed(1) }}</span>
              <span class="qs-unit">km</span>
              <span class="qs-label">Pandang</span>
            </div>
            <div class="qs-divider"/>
            <div class="quick-stat">
              <span class="qs-val" :style="{ color: uvColor(weatherData.daily.uv_index_max[0]) }">{{ weatherData.daily.uv_index_max[0] }}</span>
              <span class="qs-unit">UV</span>
              <span class="qs-label">Indeks Max</span>
            </div>
          </div>
        </section>

        <!-- Section rule -->
        <div class="section-rule">
          <div class="sr-thick"/>
          <div class="sr-label">DATA TERPERINCI</div>
          <div class="sr-thick sr-thick--right"/>
        </div>

        <!-- ── MIDDLE: metrics + solar ────────────────────────────────────── -->
        <section class="middle">

          <!-- Metrics grid -->
          <div class="metrics-block">
            <h3 class="block-heading">Kondisi Saat Ini</h3>
            <div class="metrics-table">

              <div class="mt-row" v-for="(item, i) in [
                { label: 'Suhu Udara',     val: Math.round(weatherData.current.temperature_2m),        unit: '°C' },
                { label: 'Terasa Seperti', val: Math.round(weatherData.current.apparent_temperature),  unit: '°C' },
                { label: 'Titik Embun',    val: Math.round(weatherData.current.dew_point_2m),          unit: '°C' },
                { label: 'Tekanan',        val: weatherData.current.surface_pressure,                  unit: 'hPa' },
                { label: 'Tutupan Awan',   val: weatherData.current.cloud_cover,                       unit: '%' },
                { label: 'Presipitasi',    val: weatherData.current.precipitation,                     unit: 'mm' },
              ]" :key="item.label" :style="`animation-delay: ${i * 0.06}s`">
                <span class="mt-idx">{{ String(i+1).padStart(2,'0') }}</span>
                <span class="mt-label">{{ item.label }}</span>
                <span class="mt-bar-wrap"><span class="mt-bar" :style="{ width: `${Math.min(Math.abs(item.val) / 100 * 100, 100)}%` }"/></span>
                <span class="mt-val">{{ item.val }}<span class="mt-unit">{{ item.unit }}</span></span>
              </div>

            </div>
          </div>

          <!-- Solar + UV block -->
          <div class="solar-block">
            <h3 class="block-heading">Siklus Matahari</h3>

            <!-- Sun arc SVG -->
            <div class="sun-arc-wrap">
              <svg viewBox="0 0 260 140" class="sun-arc-svg">
                <!-- arc path -->
                <path d="M 20 130 A 110 110 0 0 1 240 130" fill="none" stroke="currentColor" stroke-width="1" opacity="0.2"/>
                <!-- progress fill -->
                <path d="M 20 130 A 110 110 0 0 1 240 130" fill="none" stroke="currentColor" stroke-width="2.5"
                  stroke-dasharray="345" :stroke-dashoffset="345 - (345 * sunProgress)" stroke-linecap="round" class="arc-progress"/>
                <!-- sun dot -->
                <circle :cx="sunDotX" :cy="sunDotY" r="5" fill="currentColor" class="sun-dot"/>
                <!-- labels -->
                <text x="20" y="148" font-size="9" fill="currentColor" opacity="0.5" text-anchor="middle" font-family="monospace">{{ formatTime(weatherData.daily.sunrise[0]) }}</text>
                <text x="240" y="148" font-size="9" fill="currentColor" opacity="0.5" text-anchor="middle" font-family="monospace">{{ formatTime(weatherData.daily.sunset[0]) }}</text>
                <text x="130" y="78" font-size="9" fill="currentColor" opacity="0.4" text-anchor="middle" font-family="monospace">{{ formatDaylight(weatherData.daily.daylight_duration[0]) }}</text>
              </svg>
            </div>

            <!-- UV bar -->
            <div class="uv-row">
              <span class="uv-label">Indeks UV</span>
              <div class="uv-track">
                <div class="uv-fill" :style="{ width: `${Math.min(weatherData.daily.uv_index_max[0] / 11 * 100, 100)}%`, background: uvColor(weatherData.daily.uv_index_max[0]) }"/>
              </div>
              <span class="uv-val" :style="{ color: uvColor(weatherData.daily.uv_index_max[0]) }">{{ weatherData.daily.uv_index_max[0] }}</span>
            </div>

            <!-- AQI detail -->
            <template v-if="weatherData.air_quality">
              <h3 class="block-heading" style="margin-top: 28px">Kualitas Udara</h3>
              <div class="aqi-rows">
                <div class="aqi-row" v-for="(item, i) in [
                  { label: 'PM2.5', val: weatherData.air_quality.pm2_5, max: 150 },
                  { label: 'PM10',  val: weatherData.air_quality.pm10,  max: 200 },
                  { label: 'NO₂',   val: weatherData.air_quality.nitrogen_dioxide, max: 200 },
                  { label: 'O₃',    val: weatherData.air_quality.ozone, max: 200 },
                ]" :key="item.label" :style="`animation-delay:${i*0.08+0.4}s`">
                  <span class="ar-label">{{ item.label }}</span>
                  <div class="ar-track">
                    <div class="ar-fill" :style="{ width: `${Math.min(item.val / item.max * 100, 100)}%`,
                      background: aqiColor(weatherData.air_quality!) }"/>
                  </div>
                  <span class="ar-val">{{ item.val }}<span class="ar-unit"> µg/m³</span></span>
                </div>
              </div>
            </template>
          </div>

        </section>

        <!-- Section rule -->
        <div class="section-rule">
          <div class="sr-thick"/>
          <div class="sr-label">PROYEKSI CUACA</div>
          <div class="sr-thick sr-thick--right"/>
        </div>

        <!-- ── FORECAST: 5-day ─────────────────────────────────────────────── -->
        <section class="forecast-section">
          <div class="forecast-grid">
            <div
              v-for="i in 5" :key="i"
              class="forecast-card"
              :style="`animation-delay: ${i * 0.09}s`"
            >
              <!-- Day header -->
              <div class="fc-day">{{ getDayName(weatherData.daily.time[i]) }}</div>
              <div class="fc-fullday">{{ getFullDay(weatherData.daily.time[i]) }}</div>

              <!-- Temp range graphic -->
              <div class="fc-range-wrap">
                <div class="fc-range-track">
                  <div class="fc-range-bar"
                    :style="{
                      left:  barLeft(weatherData.daily.temperature_2m_min[i]),
                      width: barWidth(weatherData.daily.temperature_2m_max[i]),
                    }"
                  />
                </div>
              </div>

              <div class="fc-temps">
                <span class="fc-min">{{ Math.round(weatherData.daily.temperature_2m_min[i]) }}°</span>
                <span class="fc-max">{{ Math.round(weatherData.daily.temperature_2m_max[i]) }}°</span>
              </div>

              <!-- Precip row -->
              <div class="fc-precip" v-if="weatherData.daily.precipitation_probability_max[i] > 0">
                <span class="fc-precip-icon">◈</span>
                <span class="fc-precip-val">{{ weatherData.daily.precipitation_probability_max[i] }}%</span>
                <span class="fc-rain-window">{{ weatherData.daily.precipitation_summary[i] }}</span>
              </div>
              <div class="fc-precip fc-precip--clear" v-else>
                <span class="fc-precip-icon">◇</span>
                <span class="fc-rain-window">Cerah</span>
              </div>

              <!-- Wind bar -->
              <div class="fc-wind">
                <div class="fc-wind-track">
                  <div class="fc-wind-fill"
                    :style="{ width: `${Math.min(weatherData.daily.wind_speed_10m_max[i] / 80 * 100, 100).toFixed(0)}%` }"/>
                </div>
                <span class="fc-wind-val">{{ weatherData.daily.wind_speed_10m_max[i] }} km/h</span>
              </div>
            </div>
          </div>
        </section>

        <!-- Section rule -->
        <div class="section-rule">
          <div class="sr-thick"/>
          <div class="sr-label">REKOMENDASI</div>
          <div class="sr-thick sr-thick--right"/>
        </div>

        <!-- ── DIRECTIVES ──────────────────────────────────────────────────── -->
        <section class="directives-section">
          <div class="dir-grid">
            <div
              v-for="(d, idx) in directives"
              :key="idx"
              class="dir-card"
              :style="`animation-delay: ${idx * 0.07 + 0.2}s`"
            >
              <span class="dir-num">{{ String(idx + 1).padStart(2, '0') }}</span>
              <p class="dir-text">{{ d }}</p>
              <div class="dir-line"/>
            </div>
          </div>
        </section>

        <!-- Footer rule -->
        <div class="footer-rule">
          <div class="fr-line"/>
          <div class="fr-text">ATMOSFERA · Data: Open-Meteo · {{ utcClock }}</div>
          <div class="fr-line"/>
        </div>

      </main>
    </Transition>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=DM+Mono:wght@300;400&display=swap');

/* ── Design tokens ───────────────────────────────────────────────────────── */
.shell {
  --ink:       #1A1916;
  --ink-2:     #5C5A55;
  --ink-3:     #A8A69E;
  --paper:     #F5F2EA;
  --paper-2:   #EDE9DF;
  --rule:      #C8C4BA;
  --rule-dark: #8A877F;
  --accent:    #C94B2A;

  --c-ok-bg:     #E8F2E2; --c-ok-fg:     #2D6A4F;
  --c-fair-bg:   #FEF8DC; --c-fair-fg:   #7A5000;
  --c-warn-bg:   #FAEAE4; --c-warn-fg:   #9A3A1A;
  --c-poor-bg:   #FDECEA; --c-poor-fg:   #8B1A1A;
  --c-danger-bg: #F8EAF4; --c-danger-fg: #7A1550;
  --c-hazard-bg: #1A1916; --c-hazard-fg: #F5F2EA;

  --display: 'Playfair Display', Georgia, serif;
  --mono:    'DM Mono', ui-monospace, monospace;

  font-family: var(--mono);
  background:  var(--paper);
  color:       var(--ink);
  min-height:  100vh;
  overflow-x:  hidden;
  position:    relative;
}

/* ── Generative background ──────────────────────────────────────────────── */
.bg-canvas {
  position: fixed; inset: 0;
  pointer-events: none; z-index: 0;
  color: var(--ink);
}
.bg-svg { width: 100%; height: 100%; }
.bg-watermark {
  font-family: var(--display);
  font-weight: 900; font-style: italic;
  letter-spacing: -0.05em;
}

/* Mood: clear */
.ring { transform-origin: 960px 120px; animation: breathe 4s ease-in-out infinite alternate; }
@keyframes breathe { from { transform: scale(1); } to { transform: scale(1.04); } }

/* Mood: rain */
.rain-line { animation: rain-drift 3s linear infinite; }
@keyframes rain-drift { from { transform: translateY(-20px); } to { transform: translateY(20px); } }

/* Mood: cloudy */
.blob { animation: drift 8s ease-in-out infinite alternate; }
.blob-1 { animation-duration: 9s; }
.blob-2 { animation-duration: 11s; animation-delay: -3s; }
.blob-3 { animation-duration: 7s; animation-delay: -1s; }
@keyframes drift { from { transform: translate(0,0) scale(1); } to { transform: translate(20px,12px) scale(1.05); } }

/* Mood: storm */
.lightning { animation: flash 2.4s ease-in-out infinite alternate; }
@keyframes flash { 0%,90% { opacity: 0.06; } 95% { opacity: 0.18; } 100% { opacity: 0.06; } }

/* Mood: cold */
.snowdot { animation: twinkle 2s ease-in-out infinite alternate; }
@keyframes twinkle { from { opacity: 0.03; } to { opacity: 0.12; } }

/* ── Grain ──────────────────────────────────────────────────────────────── */
.grain {
  position: fixed; inset: 0; z-index: 1; pointer-events: none; opacity: 0.028;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  background-size: 180px;
  animation: grain-shift 0.12s steps(1) infinite;
}
@keyframes grain-shift {
  0%  { transform: translate(0, 0); }
  25% { transform: translate(-2px, 1px); }
  50% { transform: translate(1px, -1px); }
  75% { transform: translate(2px, 2px); }
}

/* ── Masthead ────────────────────────────────────────────────────────────── */
.masthead {
  position: relative; z-index: 10;
  display: flex; justify-content: space-between; align-items: flex-end;
  padding: 32px 48px 20px;
  gap: 24px; flex-wrap: wrap;
}
.masthead-left { display: flex; flex-direction: column; gap: 2px; }
.issue-info {
  display: flex; align-items: center; gap: 8px;
  font-size: 9px; letter-spacing: 0.16em;
  text-transform: uppercase; color: var(--ink-3);
}
.issue-sep { color: var(--rule); }
.masthead-title {
  font-family: var(--display);
  font-size: clamp(36px, 6vw, 72px);
  font-weight: 900; font-style: italic;
  letter-spacing: -0.03em; line-height: 1;
  color: var(--ink);
}
.masthead-sub {
  font-size: 9px; letter-spacing: 0.2em;
  text-transform: uppercase; color: var(--ink-3);
  margin-top: 4px;
}

.masthead-right { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
.search-block { display: flex; }
.search-inp {
  background: transparent;
  border: none; border-bottom: 1.5px solid var(--rule-dark);
  padding: 8px 0; width: 200px;
  font-family: var(--mono); font-size: 13px;
  color: var(--ink); outline: none;
  letter-spacing: 0.04em;
  transition: border-color 0.2s;
}
.search-inp::placeholder { color: var(--ink-3); }
.search-inp:focus { border-color: var(--ink); }
.search-inp:disabled { opacity: 0.4; }
.search-btn {
  background: var(--ink); color: var(--paper);
  border: none; padding: 8px 14px;
  font-family: var(--mono); font-size: 14px;
  cursor: pointer; transition: opacity 0.15s;
}
.search-btn:hover:not(:disabled) { opacity: 0.75; }
.search-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.spin { display: inline-block; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.locate-btn {
  display: flex; align-items: center; gap: 6px;
  background: transparent; border: none;
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--ink-3); cursor: pointer;
  transition: color 0.15s;
  padding: 0;
}
.locate-btn:hover:not(:disabled) { color: var(--ink); }
.locate-btn:disabled { opacity: 0.3; cursor: not-allowed; }

/* ── Masthead rules ──────────────────────────────────────────────────────── */
.masthead-rule {
  position: relative; z-index: 10;
  margin: 0 48px; display: flex; flex-direction: column; gap: 4px;
}
.rule-thick { height: 2.5px; background: var(--ink); }
.rule-thin  { height: 0.75px; background: var(--ink); opacity: 0.35; }

/* ── History bar ─────────────────────────────────────────────────────────── */
.history-bar {
  position: relative; z-index: 10;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 48px; flex-wrap: wrap;
  border-bottom: 0.75px solid var(--rule);
  font-size: 10px; letter-spacing: 0.1em;
}
.history-label { color: var(--ink-3); text-transform: uppercase; }
.history-btn {
  background: none; border: none;
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--ink-2); cursor: pointer; padding: 0;
  transition: color 0.15s;
}
.history-btn:hover { color: var(--ink); }
.history-clear {
  background: none; border: none;
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--accent); cursor: pointer; padding: 0;
  opacity: 0.6; margin-left: auto;
  transition: opacity 0.15s;
}
.history-clear:hover { opacity: 1; }

/* ── Error / Loading / Empty ─────────────────────────────────────────────── */
.error-strip {
  position: relative; z-index: 10;
  display: flex; align-items: center; gap: 12px;
  padding: 12px 48px;
  background: var(--accent); color: var(--paper);
  font-size: 11px; letter-spacing: 0.06em;
}
.error-flag {
  width: 18px; height: 18px;
  border: 1.5px solid var(--paper);
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: bold; flex-shrink: 0;
}

.loading-wrap {
  position: relative; z-index: 10;
  padding: 60px 48px;
  display: flex; justify-content: center;
}
.loading-ticker {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--ink-3);
}
.ticker-char { animation: ticker-blink 0.8s ease-in-out infinite alternate; }
@keyframes ticker-blink { from { opacity: 0.1; } to { opacity: 0.8; } }
.ticker-text { margin: 0 8px; }

.empty-page {
  position: relative; z-index: 10;
  padding: 80px 48px 60px;
  text-align: center;
}
.empty-dashes {
  font-family: var(--display);
  font-size: 48px; font-weight: 400; font-style: italic;
  color: var(--rule); letter-spacing: 0.2em;
  margin-bottom: 16px;
}
.empty-instruction {
  font-size: 11px; color: var(--ink-3);
  letter-spacing: 0.12em; text-transform: uppercase;
}
.empty-rule { width: 60px; height: 1px; background: var(--rule); margin: 24px auto 0; }

/* ── Content wrapper ─────────────────────────────────────────────────────── */
.content {
  position: relative; z-index: 10;
  padding: 0 48px 80px;
}
.content > * {
  opacity: 0; transform: translateY(12px);
  transition: opacity 0.5s ease, transform 0.5s ease;
}
.content.is-ready > * { opacity: 1; transform: translateY(0); }
.content.is-ready > *:nth-child(1) { transition-delay: 0.05s; }
.content.is-ready > *:nth-child(2) { transition-delay: 0.12s; }
.content.is-ready > *:nth-child(3) { transition-delay: 0.18s; }
.content.is-ready > *:nth-child(4) { transition-delay: 0.24s; }
.content.is-ready > *:nth-child(5) { transition-delay: 0.30s; }
.content.is-ready > *:nth-child(6) { transition-delay: 0.36s; }
.content.is-ready > *:nth-child(7) { transition-delay: 0.40s; }
.content.is-ready > *:nth-child(8) { transition-delay: 0.44s; }

/* ── Section rules ───────────────────────────────────────────────────────── */
.section-rule {
  display: flex; align-items: center; gap: 0;
  margin: 32px 0 24px; border-top: 2px solid var(--ink);
  padding-top: 6px;
}
.sr-thick { flex: 1; }
.sr-thick--right { flex: 3; }
.sr-label {
  font-size: 8px; letter-spacing: 0.22em;
  text-transform: uppercase; color: var(--ink-2);
  padding: 0 16px; white-space: nowrap;
}

/* ── FRONT section ───────────────────────────────────────────────────────── */
.front {
  display: grid;
  grid-template-columns: 2fr 3fr 1fr;
  gap: 0;
  min-height: 260px;
  border-bottom: 1px solid var(--rule);
  padding: 28px 0 32px;
}

.front-col { padding: 0 28px; position: relative; }
.front-col:first-child { padding-left: 0; }
.front-col:last-child  { padding-right: 0; }

.col-rule--right::after {
  content: ''; position: absolute;
  right: 0; top: 0; bottom: 0;
  width: 0.75px; background: var(--rule);
}

.eyebrow {
  display: flex; align-items: center; gap: 6px;
  font-size: 9px; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--ink-3);
  margin-bottom: 10px;
}
.eyebrow-sep { color: var(--rule); }

.city-headline {
  font-family: var(--display);
  font-size: clamp(28px, 4vw, 52px);
  font-weight: 700; line-height: 1.02;
  letter-spacing: -0.025em;
  color: var(--ink); margin-bottom: 8px;
}
.city-desc {
  font-size: 11px; color: var(--ink-2);
  letter-spacing: 0.08em; margin-bottom: 20px;
  text-transform: uppercase;
}

.status-band {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 5px 12px;
  font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;
  margin-bottom: 12px;
}
.status-band--ok   { background: var(--c-ok-bg);   color: var(--c-ok-fg); }
.status-band--warn { background: var(--c-warn-bg);  color: var(--c-warn-fg); }
.status-band-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }

.aqi-pill {
  display: inline-flex; align-items: center; gap: 0;
  padding: 5px 0; margin-bottom: 16px;
  font-size: 10px; letter-spacing: 0.06em;
}
.aqi-num { font-family: var(--display); font-size: 22px; font-weight: 700; margin-right: 8px; line-height: 1; }
.aqi-sep { width: 0.75px; height: 28px; background: currentColor; opacity: 0.3; margin-right: 8px; }
.aqi-label { text-transform: uppercase; letter-spacing: 0.1em; margin-right: 8px; }
.aqi-poll { opacity: 0.6; }

.dateline {
  font-size: 9px; color: var(--ink-3);
  letter-spacing: 0.1em; margin-top: auto;
}

/* Temperature hero */
.front-col--temp {
  display: flex; flex-direction: column;
  justify-content: center; align-items: flex-start;
  border-right: 0.75px solid var(--rule);
}
.temp-super { display: flex; align-items: flex-start; line-height: 1; }
.temp-digits {
  font-family: var(--display);
  font-size: clamp(80px, 14vw, 160px);
  font-weight: 900; font-style: italic;
  letter-spacing: -0.05em;
  color: var(--ink);
  /* Counting animation */
  animation: none;
  transition: none;
}
.temp-deg {
  font-family: var(--display);
  font-size: clamp(24px, 4vw, 44px);
  font-weight: 400; font-style: italic;
  color: var(--ink-2); margin-top: 12px; margin-left: 6px;
}
.temp-feels {
  font-size: 11px; color: var(--ink-3);
  letter-spacing: 0.1em; text-transform: uppercase;
  margin-top: 8px;
}

/* Quick stats vertical strip */
.front-col--stats {
  display: flex; flex-direction: column;
  gap: 0; padding-left: 20px;
}
.quick-stat {
  display: flex; flex-direction: column;
  padding: 12px 0; flex: 1;
}
.qs-val {
  font-family: var(--display);
  font-size: 28px; font-weight: 700; letter-spacing: -0.03em;
  line-height: 1; color: var(--ink);
}
.qs-unit {
  font-size: 10px; color: var(--ink-3);
  letter-spacing: 0.1em; margin-top: 2px;
}
.qs-label {
  font-size: 9px; color: var(--ink-3);
  letter-spacing: 0.14em; text-transform: uppercase;
  margin-top: 4px;
}
.qs-divider { height: 0.75px; background: var(--rule); }

/* ── Middle: metrics + solar ─────────────────────────────────────────────── */
.middle {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 48px;
}

.block-heading {
  font-size: 8px; font-weight: 400;
  letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--ink-3); margin-bottom: 16px;
  padding-bottom: 8px; border-bottom: 0.75px solid var(--rule);
}

/* Metrics table */
.metrics-table { display: flex; flex-direction: column; }
.mt-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 0; border-bottom: 0.5px solid var(--rule);
  animation: slide-in 0.4s ease-out both;
}
.mt-row:last-child { border-bottom: none; }
@keyframes slide-in {
  from { opacity: 0; transform: translateX(-8px); }
  to   { opacity: 1; transform: translateX(0); }
}
.mt-idx   { font-size: 9px; color: var(--ink-3); width: 20px; flex-shrink: 0; }
.mt-label { font-size: 11px; color: var(--ink-2); letter-spacing: 0.04em; width: 110px; flex-shrink: 0; }
.mt-bar-wrap { flex: 1; height: 1px; background: var(--rule); position: relative; overflow: hidden; }
.mt-bar { position: absolute; left: 0; top: 0; height: 100%; background: var(--ink); transition: width 0.8s cubic-bezier(0.16,1,0.3,1); }
.mt-val { font-family: var(--display); font-size: 16px; font-weight: 700; color: var(--ink); letter-spacing: -0.02em; min-width: 56px; text-align: right; }
.mt-unit { font-family: var(--mono); font-size: 9px; color: var(--ink-3); font-weight: 400; margin-left: 2px; }

/* Solar */
.sun-arc-wrap { margin: 8px 0 16px; }
.sun-arc-svg { width: 100%; color: var(--ink); }
.arc-progress { transition: stroke-dashoffset 1.2s cubic-bezier(0.16,1,0.3,1); }
.sun-dot { animation: sun-pulse 2s ease-in-out infinite alternate; }
@keyframes sun-pulse { from { r: 5; opacity: 1; } to { r: 6; opacity: 0.7; } }

.uv-row { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
.uv-label { font-size: 9px; color: var(--ink-3); letter-spacing: 0.1em; text-transform: uppercase; width: 70px; }
.uv-track { flex: 1; height: 3px; background: var(--paper-2); border-radius: 2px; overflow: hidden; }
.uv-fill { height: 100%; border-radius: 2px; transition: width 1s cubic-bezier(0.16,1,0.3,1); }
.uv-val { font-family: var(--display); font-size: 16px; font-weight: 700; min-width: 24px; text-align: right; }

/* AQI rows */
.aqi-rows { display: flex; flex-direction: column; gap: 0; }
.aqi-row {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 0; border-bottom: 0.5px solid var(--rule);
  animation: slide-in 0.4s ease-out both;
}
.aqi-row:last-child { border-bottom: none; }
.ar-label { font-size: 10px; color: var(--ink-2); letter-spacing: 0.04em; width: 36px; flex-shrink: 0; }
.ar-track { flex: 1; height: 2px; background: var(--paper-2); border-radius: 1px; overflow: hidden; }
.ar-fill  { height: 100%; border-radius: 1px; transition: width 0.9s cubic-bezier(0.16,1,0.3,1); }
.ar-val   { font-family: var(--display); font-size: 13px; font-weight: 700; color: var(--ink); min-width: 80px; text-align: right; }
.ar-unit  { font-family: var(--mono); font-size: 9px; color: var(--ink-3); font-weight: 400; }

/* ── Forecast grid ───────────────────────────────────────────────────────── */
.forecast-section { }
.forecast-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0;
  border: 0.75px solid var(--rule);
}
.forecast-card {
  padding: 20px 16px;
  border-right: 0.75px solid var(--rule);
  display: flex; flex-direction: column; gap: 10px;
  animation: slide-in 0.45s ease-out both;
  transition: background 0.2s;
}
.forecast-card:last-child { border-right: none; }
.forecast-card:hover { background: var(--paper-2); }

.fc-day {
  font-family: var(--display);
  font-size: 22px; font-weight: 700;
  letter-spacing: -0.02em; color: var(--ink);
  line-height: 1;
}
.fc-fullday {
  font-size: 9px; color: var(--ink-3);
  letter-spacing: 0.1em; text-transform: uppercase;
}

.fc-range-wrap { padding: 4px 0; }
.fc-range-track { height: 2px; background: var(--rule); position: relative; border-radius: 1px; }
.fc-range-bar {
  position: absolute; height: 100%;
  background: var(--ink); border-radius: 1px;
  transition: left 0.8s ease, width 0.8s ease;
}

.fc-temps { display: flex; justify-content: space-between; }
.fc-min { font-size: 13px; color: var(--ink-3); }
.fc-max { font-family: var(--display); font-size: 18px; font-weight: 700; color: var(--ink); letter-spacing: -0.02em; }

.fc-precip {
  display: flex; align-items: center; gap: 5px;
  font-size: 9px; color: var(--ink-2); letter-spacing: 0.06em;
}
.fc-precip--clear { color: var(--ink-3); }
.fc-precip-icon { font-size: 10px; }
.fc-precip-val { font-weight: 500; }
.fc-rain-window { opacity: 0.7; font-size: 8px; }

.fc-wind { display: flex; align-items: center; gap: 8px; }
.fc-wind-track { flex: 1; height: 1px; background: var(--rule); overflow: hidden; }
.fc-wind-fill { height: 100%; background: var(--ink-3); transition: width 0.8s ease; }
.fc-wind-val { font-size: 9px; color: var(--ink-3); letter-spacing: 0.04em; white-space: nowrap; }

/* ── Directives ──────────────────────────────────────────────────────────── */
.directives-section { }
.dir-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0;
  border: 0.75px solid var(--rule);
}
.dir-card {
  padding: 20px 20px 16px;
  border-right: 0.75px solid var(--rule);
  border-bottom: 0.75px solid var(--rule);
  display: flex; flex-direction: column; gap: 10px;
  animation: slide-in 0.4s ease-out both;
  position: relative; overflow: hidden;
  transition: background 0.2s;
}
.dir-card:hover { background: var(--paper-2); }
.dir-num {
  font-family: var(--display);
  font-size: 40px; font-weight: 900; font-style: italic;
  color: var(--rule); letter-spacing: -0.05em; line-height: 1;
}
.dir-text {
  font-size: 12px; color: var(--ink);
  letter-spacing: 0.02em; line-height: 1.6;
  flex: 1;
}
.dir-line {
  height: 1.5px; background: var(--ink);
  width: 0; transition: width 0.6s ease 0.3s;
}
.dir-card:hover .dir-line { width: 100%; }

/* ── Footer ──────────────────────────────────────────────────────────────── */
.footer-rule {
  display: flex; align-items: center; gap: 16px;
  margin-top: 48px; padding-top: 12px;
  border-top: 2px solid var(--ink);
}
.fr-line { flex: 1; height: 0.75px; background: var(--ink); opacity: 0.2; }
.fr-text {
  font-size: 8px; letter-spacing: 0.18em;
  text-transform: uppercase; color: var(--ink-3);
  white-space: nowrap;
}

/* ── Vue transitions ─────────────────────────────────────────────────────── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.35s ease; }
.fade-enter-from,   .fade-leave-to     { opacity: 0; }

.drop-enter-active { animation: drop-in 0.3s ease-out; }
.drop-leave-active { animation: drop-in 0.2s ease-in reverse; }
@keyframes drop-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }

.page-in-enter-active { animation: page-reveal 0.6s cubic-bezier(0.16,1,0.3,1); }
@keyframes page-reveal { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

/* ── Responsive ──────────────────────────────────────────────────────────── */
@media (max-width: 960px) {
  .front { grid-template-columns: 1fr 1fr; }
  .front-col--stats { display: none; }
  .forecast-grid { grid-template-columns: repeat(3, 1fr); }
  .forecast-card:nth-child(3) { border-right: none; }
  .forecast-card:nth-child(4),
  .forecast-card:nth-child(5) { border-top: 0.75px solid var(--rule); }
  .middle { grid-template-columns: 1fr; gap: 32px; }
}

@media (max-width: 640px) {
  .masthead, .history-bar, .content { padding-left: 20px; padding-right: 20px; }
  .masthead-rule { margin: 0 20px; }
  .front { grid-template-columns: 1fr; padding: 20px 0; }
  .front-col--temp { border-right: none; border-top: 0.75px solid var(--rule); padding-top: 16px; }
  .col-rule--right::after { display: none; }
  .forecast-grid { grid-template-columns: 1fr 1fr; }
  .forecast-card:nth-child(2n) { border-right: none; }
  .forecast-card:nth-child(n+3) { border-top: 0.75px solid var(--rule); }
  .temp-digits { font-size: 80px; }
  .city-headline { font-size: 32px; }
}
</style>