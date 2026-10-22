// App móvil de Clima Huauchinango.
// Lee /api/pronostico (servidor Node) y pinta condiciones actuales,
// el análisis de Gemini, las próximas horas y los próximos días por fuente.

const $ = (sel) => document.querySelector(sel);
const CLAVE_CACHE = 'clima-huauchinango:ultimo';

let datos = null;
let fuente = 'ia';
let iaCargando = false;

// En GitHub Pages no hay servidor: GitHub Actions publica cada hora un JSON
// con las fuentes y el análisis de la IA ya hecho.
const ESTATICO = location.hostname.endsWith('github.io');

// Códigos WMO de Open-Meteo → icono y descripción.
const WMO = {
  0: ['☀️', 'Despejado'], 1: ['🌤️', 'Mayormente despejado'], 2: ['⛅', 'Parcialmente nublado'],
  3: ['☁️', 'Nublado'], 45: ['🌫️', 'Niebla'], 48: ['🌫️', 'Niebla con escarcha'],
  51: ['🌦️', 'Llovizna ligera'], 53: ['🌦️', 'Llovizna'], 55: ['🌧️', 'Llovizna intensa'],
  56: ['🌧️', 'Llovizna helada'], 57: ['🌧️', 'Llovizna helada'],
  61: ['🌦️', 'Lluvia ligera'], 63: ['🌧️', 'Lluvia'], 65: ['🌧️', 'Lluvia fuerte'],
  66: ['🌧️', 'Lluvia helada'], 67: ['🌧️', 'Lluvia helada'],
  71: ['🌨️', 'Nieve ligera'], 73: ['🌨️', 'Nieve'], 75: ['❄️', 'Nieve fuerte'], 77: ['🌨️', 'Granizo fino'],
  80: ['🌦️', 'Chubascos'], 81: ['🌧️', 'Chubascos'], 82: ['⛈️', 'Chubascos fuertes'],
  85: ['🌨️', 'Chubascos de nieve'], 86: ['🌨️', 'Chubascos de nieve'],
  95: ['⛈️', 'Tormenta'], 96: ['⛈️', 'Tormenta con granizo'], 99: ['⛈️', 'Tormenta con granizo'],
};
const wmo = (c, noche) => {
  const [i, d] = WMO[c] ?? ['🌡️', '—'];
  return [noche && c <= 1 ? '🌙' : i, d];
};

// Icono a partir de un texto (SMN o Gemini).
function iconoTexto(t = '', niebla = false, lluvia = 0) {
  t = t.toLowerCase();
  if (niebla || t.includes('niebla')) return '🌫️';
  if (t.includes('tormenta')) return '⛈️';
  if (t.includes('lluvia') || t.includes('chubasco') || lluvia >= 60) return '🌧️';
  if (t.includes('llovizna') || lluvia >= 30) return '🌦️';
  if (t.includes('despejado')) return '☀️';
  if (t.includes('poco nuboso') || t.includes('medio nublado') || t.includes('parcial')) return '⛅';
  if (t.includes('nublado') || t.includes('nuboso')) return '☁️';
  return '🌤️';
}

const r = (n) => (n === null || n === undefined || Number.isNaN(n) ? '–' : Math.round(n));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fechaLocal = (iso) => new Date(iso + 'T12:00:00');
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

function nombreDia(iso) {
  const hoy = hoyISO();
  const manana = new Date(fechaLocal(hoy).getTime() + 864e5).toLocaleDateString('en-CA');
  const f = fechaLocal(iso);
  const corto = f.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  if (iso === hoy) return ['Hoy', corto];
  if (iso === manana) return ['Mañana', corto];
  const n = f.toLocaleDateString('es-MX', { weekday: 'long' });
  return [n[0].toUpperCase() + n.slice(1), corto];
}

// ---------------------------------------------------------------- render

function pintarActual() {
  const a = datos.openMeteo.actual;
  const [icono, desc] = wmo(a.weather_code, !a.is_day);
  $('#actual').innerHTML = `
    <div class="actual-fila">
      <div class="actual-icono">${icono}</div>
      <div>
        <div class="actual-temp">${r(a.temperature_2m)}°</div>
        <div class="actual-desc">${desc} · sensación ${r(a.apparent_temperature)}°</div>
      </div>
    </div>
    <div class="datos">
      <div><span>Humedad</span><b>${r(a.relative_humidity_2m)}%</b></div>
      <div><span>Viento</span><b>${r(a.wind_speed_10m)} km/h</b></div>
      <div><span>Nubes</span><b>${r(a.cloud_cover)}%</b></div>
    </div>`;
}

function pintarIA() {
  const ia = datos.ia;
  const caja = $('#ia');
  caja.hidden = false;

  if (iaCargando && !ia?.resumen) {
    caja.className = 'tarjeta ia';
    caja.innerHTML = '<h2>✨ Pronóstico con IA</h2><p>Analizando las fuentes con Gemini… puede tardar hasta un minuto.</p>';
    return;
  }

  if (!ia || ia.error) {
    caja.className = 'tarjeta ia error';
    caja.innerHTML = `<h2>✨ Pronóstico con IA</h2><p>No disponible: ${esc(ia?.error ?? 'sin respuesta')}.</p>`;
    $('#alertas').innerHTML = '';
    return;
  }

  caja.className = 'tarjeta ia';
  const recs = ia.recomendaciones?.length
    ? `<ul>${ia.recomendaciones.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
    : '';
  caja.innerHTML = `
    <h2>✨ Pronóstico con IA</h2>
    <p>${esc(ia.resumen)}</p>
    ${recs}
    <div class="meta">Combina Open-Meteo (ECMWF, GFS, ICON, GEM) y SMN · ${esc(ia.modelo)} · ${
      iaCargando ? 'actualizando…' : !ia.generado ? '' : new Date(ia.generado).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })
    }</div>`;

  $('#alertas').innerHTML = (ia.alertas ?? []).map((x) => `<div class="alerta">⚠️ ${esc(x)}</div>`).join('');
}

function pintarHoras() {
  const h = datos.openMeteo.horario;
  const ahora = Date.now() - 3600e3;
  const items = [];
  for (let i = 0; i < h.time.length && items.length < 24; i++) {
    const t = new Date(h.time[i] + ':00-06:00');
    if (t.getTime() < ahora) continue;
    const hr = t.toLocaleTimeString('es-MX', { hour: 'numeric', hour12: true, timeZone: 'America/Mexico_City' });
    const horaLocal = (t.getUTCHours() + 18) % 24;
    const noche = horaLocal < 7 || horaLocal >= 19;
    const prob = h.precipitation_probability[i];
    items.push(`
      <div class="hora">
        <div>${items.length === 0 ? 'Ahora' : hr}</div>
        <div class="i">${wmo(h.weather_code[i], noche)[0]}</div>
        <b>${r(h.temperature_2m[i])}°</b>
        <div class="p">${prob >= 20 ? prob + '%' : ''}</div>
      </div>`);
  }
  $('#horas').innerHTML = items.join('');
}

function diasPorFuente() {
  if (fuente === 'smn') {
    return datos.smn.map((d) => ({
      ...d,
      icono: iconoTexto(d.cielo, false, d.probLluvia),
      nota: `${d.cielo} · viento ${d.dirViento?.toLowerCase() ?? ''} ${r(d.viento)} km/h`,
    }));
  }
  if (fuente === 'om') {
    const d = datos.openMeteo.diario;
    const hoy = hoyISO();
    return d.time
      .map((fecha, i) => ({
        fecha,
        tmax: d.temperature_2m_max[i],
        tmin: d.temperature_2m_min[i],
        probLluvia: d.precipitation_probability_max[i],
        lluviaMm: d.precipitation_sum[i],
        icono: wmo(d.weather_code[i])[0],
        nota: `${wmo(d.weather_code[i])[1]} · UV ${r(d.uv_index_max[i])} · ráfagas ${r(d.wind_gusts_10m_max[i])} km/h`,
      }))
      .filter((x) => x.fecha >= hoy);
  }
  if (datos.ia?.dias) {
    return datos.ia.dias.map((d) => ({ ...d, icono: iconoTexto(d.cielo, d.niebla, d.probLluvia) }));
  }
  return [];
}

function pintarDias() {
  const lista = diasPorFuente();
  if (!lista.length) {
    const motivo = fuente === 'smn'
      ? datos.smnError ?? 'sin datos del SMN'
      : iaCargando ? 'la IA sigue analizando…' : datos.ia?.error ?? 'la IA no está disponible';
    $('#dias').innerHTML = `<li class="vacio">Sin datos: ${esc(motivo)}.</li>`;
    return;
  }
  $('#dias').innerHTML = lista
    .map((d) => {
      const [nombre, corto] = nombreDia(d.fecha);
      const lluvia = d.probLluvia ? `💧${r(d.probLluvia)}%${d.lluviaMm >= 1 ? `<br>${r(d.lluviaMm)} mm` : ''}` : '';
      const chips = fuente === 'ia'
        ? `<span class="chip ${esc(d.confianza)}">confianza ${esc(d.confianza)}</span>${d.niebla ? '<span class="chip">niebla</span>' : ''}`
        : '';
      return `
        <li class="dia">
          <div class="dia-fila">
            <div class="dia-nombre">${nombre}<small>${corto}</small></div>
            <div class="dia-icono">${d.icono}</div>
            <div class="dia-lluvia">${lluvia}</div>
            <div class="dia-temps"><span class="max">${r(d.tmax)}°</span><span class="min">${r(d.tmin)}°</span></div>
          </div>
          <div class="dia-nota">${chips}${esc(d.nota)}</div>
        </li>`;
    })
    .join('');
}

function pintarTodo() {
  pintarActual();
  pintarIA();
  pintarHoras();
  pintarDias();
  const g = new Date(datos.generado);
  $('#actualizado').textContent = 'actualizado ' + g.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
}

// ---------------------------------------------------------------- datos

async function cargar(forzar = false) {
  const btn = $('#btn-actualizar');
  btn.classList.add('girando');
  try {
    const url = ESTATICO ? 'data/pronostico.json?t=' + Date.now() : 'api/pronostico' + (forzar ? '?actualizar' : '');
    // Sin límite, una red móvil inestable deja la app en «cargando…» indefinidamente.
    const control = new AbortController();
    const limite = setTimeout(() => control.abort(), ESTATICO ? 20e3 : 60e3);
    const res = await fetch(url, { cache: 'no-store', signal: control.signal }).finally(() => clearTimeout(limite));
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Error del servidor');
    datos = ESTATICO ? json : { ...json, ia: datos?.ia };
    guardar();
    pintarTodo();
  } catch (e) {
    const motivo = e.name === 'AbortError' ? 'la conexión tardó demasiado' : e.message;
    if (!datos) {
      $('#actual').innerHTML = `<p class="vacio">No se pudo cargar el pronóstico: ${esc(motivo)}. Toca ⟳ para reintentar.</p>`;
    }
    $('#actualizado').textContent = datos ? 'sin conexión, datos guardados' : 'sin conexión';
  } finally {
    btn.classList.remove('girando');
  }
  if (datos && !ESTATICO) cargarIA(forzar);
}

// La IA tarda más, así que se pide aparte y se pinta cuando llega.
async function cargarIA(forzar) {
  if (iaCargando) return;
  iaCargando = true;
  pintarIA();
  if (fuente === 'ia') pintarDias();
  try {
    const res = await fetch('api/ia' + (forzar ? '?actualizar' : ''));
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Error del servidor');
    datos.ia = json;
    guardar();
  } catch (e) {
    // Si ya había un análisis anterior, se conserva; si no, se muestra el error.
    if (!datos.ia?.resumen) datos.ia = { error: e.message };
  } finally {
    iaCargando = false;
    pintarIA();
    if (fuente === 'ia') pintarDias();
  }
}

function guardar() {
  try { localStorage.setItem(CLAVE_CACHE, JSON.stringify(datos)); } catch {}
}

$('#btn-actualizar').addEventListener('click', () => cargar(true));

document.querySelectorAll('.selector button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.selector button').forEach((x) => x.classList.toggle('activo', x === b));
    fuente = b.dataset.fuente;
    if (datos) pintarDias();
  }),
);

// Muestra lo último guardado al instante y después actualiza.
try {
  const guardado = JSON.parse(localStorage.getItem(CLAVE_CACHE));
  if (guardado) { datos = guardado; pintarTodo(); }
} catch {}
cargar();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
