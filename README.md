# Clima Huauchinango

App móvil (PWA) con el pronóstico del clima para Huauchinango, Puebla.

- **Open-Meteo**: condiciones actuales, 48 h por hora y 7 días, y por separado los modelos ECMWF, GFS, ICON y GEM.
- **SMN / CONAGUA**: pronóstico oficial por municipio (estado 21, municipio 71), 4 días.
- **Gemini**: compara las fuentes, corrige sesgos conocidos de la Sierra Norte (lluvia orográfica, niebla, nortes) y entrega un pronóstico consensuado con nivel de confianza, alertas y recomendaciones.

## Uso

```bash
cp .env.example .env     # y escribe tu GEMINI_API_KEY
npm start                # http://localhost:3000
```

Requiere Node 18 o superior. No tiene dependencias.

En el celular (misma red Wi-Fi) abre `http://IP-DE-TU-PC:3000`. Para instalarla como app
("Agregar a pantalla de inicio" con modo sin conexión) el navegador exige HTTPS, así que publícala en un
servicio como Render, Railway o un VPS con HTTPS.

## Estructura

- `server.js`: consulta las fuentes, llama a Gemini y guarda el resultado 30 minutos en caché (`/api/pronostico`, `?actualizar` lo fuerza).
- `public/`: la app (HTML, CSS, JS, manifest y service worker).

La llave de Gemini solo vive en el servidor; nunca se envía al teléfono.
