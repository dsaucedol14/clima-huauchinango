// Obtención de datos de Clima Huauchinango: Open-Meteo, SMN (CONAGUA) y Gemini.
// La usan el servidor local (server.js) y la generación para GitHub Pages (scripts/generar.js).

const zlib = require('zlib');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
// Se prueban en orden; si uno está saturado o tarda demasiado, se pasa al siguiente.
const GEMINI_MODELOS = (process.env.GEMINI_MODEL || 'gemini-3.8-flash,gemini-3.7-flash,gemini-flash-latest')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
const GEMINI_TIMEOUT_S = Number(process.env.GEMINI_TIMEOUT_S) || 90;

const LUGAR = {
  nombre: 'Huauchinango, Puebla',
  lat: 20.1747,
  lon: -98.0513,
  smnEstado: '21', // Puebla
  smnMunicipio: '71', // Huauchinango
  zona: 'America/Mexico_City',
};

const MODELOS_OM = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_seamless'];

async function obtener(url, opciones = {}, ms = 25000) {
  const res = await fetch(url, { ...opciones, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${new URL(url).host}`);
  return res;
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

// ---------------------------------------------------------------- Open-Meteo

async function openMeteo() {
  const base = 'https://api.open-meteo.com/v1/forecast';
  const comun = `latitude=${LUGAR.lat}&longitude=${LUGAR.lon}&timezone=${encodeURIComponent(LUGAR.zona)}`;

  const principal = `${base}?${comun}&forecast_days=7&past_days=2` +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,is_day' +
    '&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,weather_code,cloud_cover,visibility,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max,sunrise,sunset';

  const variables = 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max';
  const multimodelo = `${base}?${comun}&forecast_days=7&daily=${variables}&models=${MODELOS_OM.join(',')}`;

  const [p, m] = await Promise.all([
    obtener(principal).then((r) => r.json()),
    obtener(multimodelo).then((r) => r.json()).catch(() => null),
  ]);

  const modelos = {};
  if (m && m.daily) {
    for (const mod of MODELOS_OM) {
      modelos[mod] = m.daily.time.map((fecha, i) => ({
        fecha,
        tmax: m.daily[`temperature_2m_max_${mod}`]?.[i] ?? null,
        tmin: m.daily[`temperature_2m_min_${mod}`]?.[i] ?? null,
        lluviaMm: m.daily[`precipitation_sum_${mod}`]?.[i] ?? null,
        probLluvia: m.daily[`precipitation_probability_max_${mod}`]?.[i] ?? null,
      }));
    }
  }

  return { actual: p.current, horario: p.hourly, diario: p.daily, modelos };
}

// ---------------------------------------------------------------- SMN

async function smn() {
  const res = await obtener('https://smn.conagua.gob.mx/tools/GUI/webservices/?method=1', {}, 40000);
  const buf = Buffer.from(await res.arrayBuffer());
  let texto;
  try {
    texto = zlib.gunzipSync(buf).toString('utf8');
  } catch {
    texto = buf.toString('utf8');
  }
  const todos = JSON.parse(texto);
  return todos
    .filter((x) => x.ides === LUGAR.smnEstado && x.idmun === LUGAR.smnMunicipio)
    .map((x) => ({
      fecha: `${x.dloc.slice(0, 4)}-${x.dloc.slice(4, 6)}-${x.dloc.slice(6, 8)}`,
      tmax: num(x.tmax),
      tmin: num(x.tmin),
      lluviaMm: num(x.prec),
      probLluvia: num(x.probprec),
      cielo: x.desciel,
      nubosidad: num(x.cc),
      viento: num(x.velvien),
      rafagas: num(x.raf),
      dirViento: x.dirvienc,
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// ---------------------------------------------------------------- Gemini

const ESQUEMA = {
  type: 'OBJECT',
  properties: {
    resumen: { type: 'STRING' },
    dias: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          fecha: { type: 'STRING' },
          tmax: { type: 'NUMBER' },
          tmin: { type: 'NUMBER' },
          probLluvia: { type: 'NUMBER' },
          lluviaMm: { type: 'NUMBER' },
          cielo: { type: 'STRING' },
          niebla: { type: 'BOOLEAN' },
          confianza: { type: 'STRING', enum: ['alta', 'media', 'baja'] },
          nota: { type: 'STRING' },
        },
        required: ['fecha', 'tmax', 'tmin', 'probLluvia', 'lluviaMm', 'cielo', 'niebla', 'confianza', 'nota'],
      },
    },
    alertas: { type: 'ARRAY', items: { type: 'STRING' } },
    recomendaciones: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['resumen', 'dias', 'alertas', 'recomendaciones'],
};

function construirPrompt(om, datosSmn) {
  const hoy = om.diario.time.findIndex((f) => f === new Date().toLocaleDateString('en-CA', { timeZone: LUGAR.zona }));
  const inicio = hoy >= 0 ? hoy : 2;

  const diarioOM = om.diario.time.map((fecha, i) => ({
    fecha,
    tmax: om.diario.temperature_2m_max[i],
    tmin: om.diario.temperature_2m_min[i],
    lluviaMm: om.diario.precipitation_sum[i],
    probLluvia: om.diario.precipitation_probability_max[i],
    rafagas: om.diario.wind_gusts_10m_max[i],
    codigoWMO: om.diario.weather_code[i],
  }));

  // Humedad y visibilidad de las próximas 36 h, cada 3 h: ayudan a detectar niebla.
  const ahora = Date.now();
  const proximas = [];
  om.horario.time.forEach((t, i) => {
    const dt = new Date(t + ':00-06:00').getTime();
    if (dt >= ahora - 3600e3 && dt <= ahora + 36 * 3600e3 && i % 3 === 0) {
      proximas.push({
        hora: t,
        temp: om.horario.temperature_2m[i],
        hr: om.horario.relative_humidity_2m[i],
        rocio: om.horario.dew_point_2m[i],
        visibilidadM: om.horario.visibility[i],
        probLluvia: om.horario.precipitation_probability[i],
        nubes: om.horario.cloud_cover[i],
      });
    }
  });

  return `Eres un meteorólogo especializado en la Sierra Norte de Puebla, México.
Lugar: Huauchinango, Puebla (20.17 N, 98.05 O, unos 1,530 m s.n.m.). Es zona montañosa, muy húmeda,
expuesta a los vientos del Golfo de México: hay lluvia orográfica, niebla y llovizna frecuentes ("chipi-chipi"),
y entre octubre y marzo llegan frentes fríos y "nortes" que bajan la temperatura y traen lluvia persistente.
La temporada de ciclones del Atlántico dura hasta el 30 de noviembre.

Fecha y hora actual: ${new Date().toLocaleString('es-MX', { timeZone: LUGAR.zona })}.

DATOS:
1) Condiciones actuales (Open-Meteo): ${JSON.stringify(om.actual)}
2) Pronóstico diario de Open-Meteo (mejor modelo; los 2 primeros días ya pasaron y sirven como referencia de lo ocurrido): ${JSON.stringify(diarioOM)}
3) Pronóstico diario por modelo numérico (ECMWF, GFS, ICON, GEM): ${JSON.stringify(om.modelos)}
4) Pronóstico oficial del SMN/CONAGUA para el municipio (4 días): ${JSON.stringify(datosSmn)}
5) Próximas 36 horas cada 3 h (Open-Meteo): ${JSON.stringify(proximas)}

TAREA:
Haz un pronóstico consensuado para los 7 días a partir de ${diarioOM[inicio]?.fecha ?? 'hoy'}.
- Compara las fuentes. Si los modelos coinciden, la confianza es alta; si difieren mucho, es baja. Explica la diferencia en "nota".
- Los modelos globales tienden a subestimar la lluvia orográfica de la Sierra Norte y a sobrestimar la temperatura máxima en días nublados; corrige con criterio.
- El SMN suele captar mejor los frentes fríos; dale peso en los días que cubre.
- Marca niebla=true cuando la humedad pase de 95 %, el punto de rocío esté cerca de la temperatura o la visibilidad baje de 1,000 m.
- "alertas": solo riesgos reales (lluvia fuerte de más de 50 mm, frente frío, niebla densa en la carretera México-Tuxpan, viento fuerte o deslaves). Deja la lista vacía si no hay.
- "recomendaciones": 2 o 3 consejos prácticos y breves para la población.
- "resumen": 2 o 3 frases claras en español.
- Usa fechas en formato AAAA-MM-DD y valores numéricos redondeados a 1 decimal.
No inventes datos que contradigan todas las fuentes.`;
}

async function llamarGemini(modelo, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: ESQUEMA,
      },
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_S * 1000),
  });
  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status}: ${cuerpo.error?.message ?? 'sin detalle'}`);
  const texto = cuerpo.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  return { modelo, ...JSON.parse(texto) };
}

async function gemini(om, datosSmn) {
  if (!GEMINI_API_KEY) throw new Error('Falta GEMINI_API_KEY en el archivo .env');
  const prompt = construirPrompt(om, datosSmn);
  const fallos = [];
  for (const modelo of GEMINI_MODELOS) {
    try {
      return await llamarGemini(modelo, prompt);
    } catch (e) {
      const motivo = e.name === 'TimeoutError' ? `tardó más de ${GEMINI_TIMEOUT_S} s` : e.message;
      console.log(`Gemini ${modelo} falló: ${motivo}`);
      fallos.push(`${modelo} (${motivo.slice(0, 80)})`);
    }
  }
  throw new Error(`Gemini no respondió. Intentos: ${fallos.join('; ')}`);
}

async function obtenerFuentes() {
  const [om, s] = await Promise.allSettled([openMeteo(), smn()]);
  if (om.status === 'rejected') throw new Error(`Open-Meteo no disponible: ${om.reason.message}`);
  return {
    lugar: LUGAR.nombre,
    generado: new Date().toISOString(),
    openMeteo: om.value,
    smn: s.status === 'fulfilled' ? s.value : [],
    smnError: s.status === 'rejected' ? s.reason.message : null,
  };
}

async function analizarConIA(f) {
  return { generado: new Date().toISOString(), ...(await gemini(f.openMeteo, f.smn)) };
}

module.exports = { LUGAR, GEMINI_API_KEY, GEMINI_MODELOS, obtenerFuentes, analizarConIA };
