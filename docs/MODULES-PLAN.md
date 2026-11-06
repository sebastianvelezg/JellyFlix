# Plan: módulos opcionales para Jellyflix

> Documento de planificación y diseño de los módulos opcionales. Vive en la rama `feature/modules-container` (creada desde `main`, release 1.3.2).
> **Estado (2026-11-06):** construidos y revisados (seguridad, rendimiento, pruebas) el contenedor `modules/` (Fase 0), **Canales / Retro TV** y **Match**, en la web **y en la app de TV**. Pendiente: **Tube**, **Wrapped**, otros módulos, relleno/rejilla de Canales (3c) e imagen publicada en ghcr. Guía de prueba y de seguridad: `modules/README.md`.
> Cambios respecto al plan original: SQLite con `node:sqlite` (sin dependencias), el contenedor no necesita API key, Match avisa por sondeo cada 2,5 s (no SSE) y en la TV Match es solo pantalla (QR). Al final hay una lista de decisiones abiertas (sección 11).

---

## 1. La idea, en una frase

Un **contenedor nuevo y opcional** (`jellyflix-modules`) que corre junto a Jellyfin y Jellyflix. Si está corriendo, Jellyflix descubre qué módulos tiene activos y muestra una página **Módulos** con ellos. Si no está, Jellyflix y Jellyfin funcionan **exactamente igual que hoy**: ni una petición extra, ni un botón extra, ni un byte extra en la primera pantalla.

Los módulos que quieres, en el orden en que los nombraste:

| Módulo | Qué hace | Dónde vive lo que produce |
|---|---|---|
| **Canales** ("Retro TV") | Canales de TV "años 2000" armados con tu biblioteca (Canal Anime 24/7, Sábado de Marvel, Cine de terror a medianoche), con guía de programación. **No emiten 24/7**: la parrilla se calcula con el reloj y solo se reproduce algo cuando alguien sintoniza, en el minuto que toca | Una parrilla en la base de datos del módulo + el reproductor normal de Jellyflix. **No se escribe nada en Jellyfin** (detalle completo: [`MODULE-CHANNELS.md`](MODULE-CHANNELS.md)) |
| **Match** (el "Tinder") | Tú y otra persona deslizan películas; si las dos dan like hay *match* y se reproduce en Jellyflix | Datos propios del módulo (SQLite) |
| **Tube** ("YouTube sin YouTube") | Te suscribes a canales; yt-dlp los baja solos, sin anuncios y con SponsorBlock | En una **biblioteca de Jellyfin** (cada canal es una serie) |
| **Wrapped** (al final) | El "Spotify Wrapped" de Jellyfin: horas, géneros, la serie que te devoraste, hora del día, comparación con otra persona, tarjetas para compartir | Datos propios + imágenes generadas |

---

## 2. Lo que ya tenemos (y por qué importa para este plan)

Revisado en el repo, rama `main`:

- **Monorepo** `web/` (React 19 + Vite + TS, SDK de Jellyfin) y `tv/` (Kotlin, Compose for TV). Sin workspaces: `web/` tiene su propio `package.json` y su `Dockerfile` usa `web/` como contexto de build.
- **Capas del web**: `src/core` (sin DOM ni React, con tests en Node), `src/platform/web`, `src/components`. Hay un linter y un `tsconfig.core.json` que fuerzan esa separación. **Todo cliente HTTP nuevo va en `core`.**
- **Rutas por hash** (`src/components/route.ts`), menú superior reordenable (`src/core/menuLayout.ts`: `arrangeMenu(available, layout)` ya dibuja solo los botones "disponibles"; `sanitizeMenuLayout` añade ids nuevos al final, así que un layout guardado no se rompe al agregar uno).
- **Docker del web**: nginx estático, solo-lectura, sin capacidades extra, `client_max_body_size 1k`, `limit_except GET { deny all; }`. La configuración en tiempo de ejecución entra por `public/config.js` (`window.JELLYFLIX_CONFIG`) escrito por `docker/40-runtime-config.sh` desde variables de entorno (`JELLYFIN_URL`).
- **CSP** (`docker/security-headers.conf` y `scripts/csp.mjs`, con un test que exige que coincidan): `connect-src *`, `script-src 'self'`. O sea: **un navegador sí puede hablar con otro origen, pero no puede cargar código de otro origen.** Esto decide la forma de la UI de los módulos (sección 4.4).
- **Live TV ya existe** en web y TV (guía, categorías, último canal, vecinos), pero es para TV real: no lo usamos para Canales. **La biblioteca de Series ya existe**, y Tube se entrega a través de ella (la TV lo recibe gratis). **El reproductor ya sabe** empezar en un segundo concreto (`?start=`) y seguir con "el siguiente título de una cola", que es la base de Canales.
- **Estadísticas** (`core/stats.ts`, `StatsPage.tsx`) ya calculan lo visto a partir de `UserData` y del plugin Playback Reporting. Wrapped parte de ahí.
- **Control remoto / "Play on…"** ya existe (la TV se registra como sesión). Un *match* puede mandar la película a la TV con eso.
- **Presupuesto de tamaño** (`scripts/check-size.mjs` + `size-budget.json`): falla el CI si la primera pantalla crece. Es nuestra red de seguridad para "no cambia nada para quien no usa módulos".
- **Principios públicos** (README "Privacy and principles", `SECURITY.md`): *"Talks only to your Jellyfin server"*, *"No backend of ours"*. Un contenedor de módulos **no los viola** (sigue siendo tuyo, no nuestro) pero **hay que reescribirlos con precisión** (sección 9).

---

## 3. Principios del diseño

1. **Opcional de verdad.** Sin contenedor: cero peticiones, cero UI, mismo bundle de primera pantalla. Se prueba, no se asume (sección 8).
2. **Jellyfin sigue siendo la fuente de verdad.** Cuentas, permisos, biblioteca y reproducción son de Jellyfin. El contenedor no crea usuarios ni guarda contraseñas.
3. **Preferir integrarse *por* Jellyfin antes que *encima* de Jellyfin, y no hacer trabajo que no haga falta.** Tube se entrega por una biblioteca + NFO (así funciona en TV y en otros clientes). Canales no emite nada: calcula una parrilla y deja que Jellyfin reproduzca cada título como siempre. **Si nadie mira, nada corre.**
4. **El contenedor falla en silencio hacia el cliente.** Si se cae, Jellyflix se comporta como si no existiera (con un mensaje claro *dentro* de la página del módulo, nunca un error global).
5. **Un módulo no puede dañar a otro ni al núcleo.** Cada módulo es una carpeta aislada con su contrato, sus tablas y sus tests. Un `ErrorBoundary` por módulo en el cliente.
6. **Todo lo que escriba en Jellyfin o en disco es explícito y reversible.** (Hoy solo Tube escribe fuera de su base de datos, en su carpeta de descargas; si algún día un módulo toca la configuración de Jellyfin: botón claro, se muestra qué se va a crear, hay botón de deshacer.)
7. **Los secretos se quedan en el servidor.** API key de Jellyfin, claves de TMDB, cookies de yt-dlp: nunca llegan al navegador.
8. **Español e inglés, accesibilidad (axe) y tests** como en el resto del proyecto: el test de i18n y el spec de axe cubren las pantallas nuevas.

### Vocabulario (para no confundirnos)

- **Plugin** = un plugin .NET *dentro de Jellyfin* (Intro Skipper, LrcLib…). Jellyflix ya los lista en Settings → Plugins. **No tocamos eso.**
- **Módulo** = una función de *nuestro* contenedor (`channels`, `match`, `tube`, `wrapped`).
- **Contenedor de módulos** = `jellyflix-modules`.

---

## 4. Arquitectura propuesta

### 4.1 Vista general

```
                       Docker / tu NAS
 ┌───────────────┐   ┌──────────────────┐   ┌───────────────────────────┐
 │ Navegador /   │   │  jellyflix-web   │   │  jellyflix-modules  (NUEVO, opcional)
 │ TV (Jellyflix)│──▶│  nginx estático  │   │  Node + SQLite + ffmpeg + yt-dlp
 └──────┬────────┘   │  /modules/ ──────┼──▶│  /v1/manifest  /v1/channels  /v1/match  /v1/tube ...
        │            └──────────────────┘   └──────┬───────────────▲────────────┘
        │  (hoy igual: API de Jellyfin)             │ valida token  │ API key (solo servidor)
        ▼                                           ▼               │
 ┌──────────────────────────────────────────────────────────────────┴──┐
 │ Jellyfin    · Reproduce cada título (lo pide Jellyflix, como hoy)   │
 │             · Biblioteca "YouTube" (carpeta ← módulo Tube)          │
 └─────────────────────────────────────────────────────────────────────┘
```

Sin el cuadro de la derecha, el diagrama es el que existe hoy.

### 4.2 El contenedor `jellyflix-modules`

- **Un solo contenedor, una sola imagen**, con los módulos adentro; cuáles están activos se decide con una variable: `JELLYFLIX_MODULES=channels,match,tube`. (Más simple de instalar que un contenedor por módulo; ver decisión 5 sobre el tamaño de imagen.)
- **Stack recomendado: Node 24 + TypeScript** (el mismo que el web). Razones: podemos compartir tipos y lógica pura con el cliente, usar vitest, y el CI/Dependabot/lint ya existen. yt-dlp y ffmpeg son binarios que se invocan, no dependen del lenguaje. Servidor HTTP ligero (Fastify o Hono), SQLite (`better-sqlite3`) en un volumen `/data`.
- **Autenticación sin cuentas nuevas**: el cliente envía el *mismo* token de Jellyfin (`Authorization: MediaBrowser Token="…"`; en tu servidor 12.2 `api_key` en la URL da 401, así que siempre cabecera). El módulo lo valida contra `GET {JELLYFIN_URL}/Users/Me`, guarda en caché ~60 s (clave = hash del token) y obtiene `userId` y si es administrador. Rutas de configuración = solo admin; rutas de uso = cualquier usuario.
- **Cuenta de servicio**: para tareas en segundo plano (leer la biblioteca para armar las parrillas, refrescar la biblioteca de Tube) usa una `JELLYFIN_API_KEY` que solo vive en el entorno del contenedor.
- **Endpoints base** (versionados `/v1`):
  - `GET /v1/health` — sin auth, solo `{status, version}` (para el healthcheck de Docker).
  - `GET /v1/manifest` — con auth. `{ api: 1, version, modules: [{ id, state: 'ready'|'needs-setup'|'error'|'disabled', detail? }] }`.
  - `/v1/<módulo>/…` — cada módulo registra sus rutas.
- **Jobs**: un planificador interno (cron-like) con cola serial por módulo, reintentos con backoff y log visible en la UI de admin. Lo usan Tube (descargas) y Canales (generar la parrilla).
- **Seguridad del contenedor**: igual de endurecido que el web (usuario no-root, `read_only` salvo `/data` y `/tmp`, `no-new-privileges`, `cap_drop: ALL`). CORS con lista de orígenes permitidos (`JELLYFLIX_ORIGINS`), no `*`.

### 4.3 Cómo lo encuentra Jellyflix (el "gate")

Orden de decisión en el cliente, en `web/src/core/modules/`:

1. **¿Hay URL configurada?** Viene de `window.JELLYFLIX_CONFIG.modulesUrl` (nueva variable `JELLYFLIX_MODULES_URL` en `40-runtime-config.sh`) o de un campo manual en Settings → Módulos (para quien sirve el zip sin Docker). **Vacía = fin. No se hace ninguna petición, no se carga ningún chunk.**
2. **Si hay URL, y solo con sesión iniciada**: *un* `GET /v1/manifest` con timeout corto (~2 s). Cualquier error de red, timeout, 401 o 5xx ⇒ "no hay módulos", **sin toast ni mensaje**. No se reintenta en bucle; se vuelve a comprobar al recargar o con el botón "Comprobar de nuevo" en Settings.
3. **Compatibilidad**: el cliente declara qué `api` entiende. Si el contenedor es más nuevo o más viejo, la página Módulos muestra un aviso ("actualiza el contenedor / Jellyflix") y nada más. Nunca rompe otra pantalla.
4. **Solo entonces** aparece: el botón **Módulos** en el menú superior (se añade `'modules'` a `MENU_IDS` como un id más, gobernado por el `available` que ya existe) y la ruta `#/modules`.

**Proxy opcional en la imagen del web**: si `JELLYFLIX_MODULES_URL` está definida, el script de arranque genera un `location /modules/ { proxy_pass … }`. Si no, el `nginx.conf` es **byte a byte el actual** (el bloque se genera solo cuando hace falta, no se edita el archivo base). El proxy evita CORS y el problema de contenido mixto cuando Jellyflix va por HTTPS. Para la TV (app nativa) y para quien no use nuestro Docker se usa la URL directa + CORS. Para el cliente ambas son solo "una URL base".

### 4.4 Dónde vive la UI de los módulos

Decisión: **la UI es parte del bundle de Jellyflix web, en chunks cargados bajo demanda (lazy), y el contenedor solo expone datos/API.**

- ✔ Estilo, i18n, accesibilidad y tests idénticos al resto de la app.
- ✔ Compatible con el CSP (`script-src 'self'`): no se carga código de otro origen en una app que maneja tu token.
- ✔ Quien no tiene el contenedor no descarga ni un byte de esos chunks (se importan con `import()` solo tras pasar el gate).
- ✘ Un módulo nuevo exige un release de Jellyflix web. Es aceptable: son módulos *de primera parte*.
- ✘ Un marketplace de módulos de terceros queda fuera de alcance. (Si algún día se quiere: iframes sandbox hacia el contenedor, sin acceso al token. No ahora.)

### 4.5 Contrato compartido

Los tipos de la API (`manifest`, cada módulo) viven en `modules/contract/` como TypeScript plano. El `Dockerfile` del web usa `web/` como contexto, así que no puede importar de afuera: un script `npm run contract:sync` copia los tipos a `web/src/core/modules/contract.ts` y el **CI falla si la copia está desactualizada**. (Cuando la TV consuma la API se evalúa pasar a OpenAPI y generar Kotlin; no antes.)

---

## 5. Estructura de carpetas

```
JellyFlix/
├─ web/                          (casi intacto; ver "Qué se toca" abajo)
│  └─ src/
│     ├─ core/modules/           cliente de la API: config, gate, http, tipos del contrato (+ tests Node)
│     └─ components/modules/     ModulesPage + una carpeta por módulo, TODO con React.lazy
├─ tv/                           (sin cambios hasta que haya un módulo con UI propia para la TV)
├─ modules/                      NUEVO
│  ├─ README.md  Dockerfile  docker-compose.yml  .env.example
│  ├─ contract/                  tipos de la API (fuente de verdad)
│  └─ server/
│     └─ src/
│        ├─ main.ts  http/  auth/jellyfin.ts  db/  jobs/  registry.ts
│        └─ modules/{channels,match,tube,wrapped}/   cada uno: rutas, servicio, migraciones, tests
├─ docs/MODULES-PLAN.md          este documento (luego docs/modules-*.md por módulo)
└─ .github/workflows/modules.yml NUEVO, con filtro de rutas (modules/**): no corre ni afecta al CI del web
```

### Qué archivos *existentes* se tocan (y solo esos)

| Archivo | Cambio | Riesgo |
|---|---|---|
| `web/src/components/route.ts` | rutas `#/modules` y `#/modules/<id>` | bajo (sólo añade casos) |
| `web/src/core/menuLayout.ts` | id `'modules'` en `MENU_IDS` | bajo (sanitize ya lo maneja) |
| Header / shell | dibujar el botón si el gate dice que hay módulos | bajo |
| `SettingsPage` | pestaña/panel "Módulos" (URL manual, comprobar de nuevo) | bajo |
| `web/public/config.js`, `docker/40-runtime-config.sh` | variable `modulesUrl` (vacía por defecto) | bajo |
| `docker/` | proxy `/modules/` **generado solo si hay variable** | medio (nginx; hay test de headers en CI) |
| `i18n/es.ts` | textos nuevos | nulo |
| `README.md`, `SECURITY.md`, `CHANGELOG.md` | principios y modelo de amenazas (sección 9) | nulo |

`web/Dockerfile`, `web/docker-compose.yml` y el CI del web **no cambian de comportamiento**.

---

## 6. Los módulos, uno por uno

### 6.1 Canales ("Retro TV")

> Diseño completo en [`MODULE-CHANNELS.md`](MODULE-CHANNELS.md). Aquí solo el resumen.

**Una televisión de mentira que solo existe cuando la miras.** Un canal es una parrilla calculada ("a esta hora toca este título"), guardada como filas en SQLite y alargada una vez al día. No hay ffmpeg, ni tuner M3U/XMLTV, ni nada registrado en Jellyfin. Cuando alguien sintoniza, Jellyflix pregunta "¿qué toca ahora y en qué minuto?" y reproduce ese título con el reproductor de siempre, empezando ahí. El coste en reposo es **cero**; viendo, es **el mismo que ver una película normal**.

- **Crear canales**: lista manual (películas, episodios, temporadas, series, colecciones, playlists de Jellyfin), reglas inteligentes (género, década, biblioteca, etiqueta, no vistas…), y un **asistente** que crea un canal por cada género o colección de una vez.
- **Dos modos**: *Maratón* (secuencia en bucle) y *Parrilla semanal* (bloques horarios: sábados de Marvel, terror a medianoche).
- **Controles**: **Empezar desde el principio**, **Siguiente**, **Anterior**, **Ir en vivo**, zapping ▲▼, guía. Tu "posición" en la línea de tiempo es el único estado; estar atrasado o adelantado es solo la diferencia con el reloj. Al salir y volver a entrar, estás otra vez en vivo.
- **Por qué cambió** respecto al diseño del tuner: un stream en vivo no permite "empezar de nuevo" ni "siguiente" por espectador, y obliga a tener ffmpeg y a registrar cosas en Jellyfin. A cambio de esto, los canales solo se ven en Jellyflix (no en otros clientes de Jellyfin) y la TV necesita su propia pantalla de canales.
- **Riesgo principal**: ya no es ffmpeg sino el reproductor (se añade un tipo de cola "canal" y botones). Se aísla y se cubre con e2e.

### 6.2 Match (el "Tinder" de pareja)

- **Modelo**: una *sala* entre 2+ usuarios **de tu mismo Jellyfin** (cada una con su cuenta). Cada usuario marca por título: `like | pass | skip`. Se crea *match* cuando todos los de la sala dan like. Tablas: `rooms`, `room_members`, `swipes`, `matches`.
- **Candidatos**, en dos fuentes:
  1. **Tu biblioteca** (MVP, sin nada externo): películas que ninguno ha visto, filtradas por género/clasificación, con el mismo filtro de modo niños que ya existe.
  2. **Cosas que aún no tienes** (fase posterior): TMDB (clave del administrador, guardada en el servidor). Un match de algo que no está se puede enviar a **Seerr/Jellyseerr** (integración opcional) como solicitud.
- **Tiempo real**: SSE (o WebSocket) para "¡Hay match!" en la otra pantalla al instante.
- **Al hacer match**: botón "Reproducir ahora" → `#/play/<id>` en Jellyflix, o "Ver en la TV" con el control remoto que ya existe.
- **UI**: tarjetas con gesto de deslizar (con botones accesibles equivalentes: el spec de axe lo exige), historial de matches, ajustes de sala.
- **Privacidad**: los swipes son de la pareja; cada quien puede borrar los suyos; no se expone nada a otros usuarios del servidor.
- *Nota sobre monetización*: lo que escribiste ("fácil de monetizar como app móvil") es otro producto — un servicio multi-usuario en la nube. Este diseño es autoalojado y de código abierto; si algún día quieres lo otro, se diseña aparte. Lo dejo fuera de este plan.

### 6.3 Tube ("YouTube sin YouTube")

- **Entrega: una biblioteca de Jellyfin.** El módulo escribe en una carpeta que *tú* añades a Jellyfin como biblioteca de "Series". Cada canal = una serie, cada año = una temporada, cada video = un episodio. Jellyflix lo muestra con las pantallas de series que ya existen. La TV también, sin cambios.
- **Estructura en disco**: `/media/youtube/<Canal>/Season <año>/<fecha> - <título> [<id>].mkv`, más `tvshow.nfo`, `<episodio>.nfo` y miniaturas. Con NFO propios evitamos que los agentes de metadatos de Jellyfin intenten emparejar el canal con algo de TMDb (se documenta apagar los agentes remotos en esa biblioteca).
- **Descarga**: yt-dlp con `--download-archive` (no repite), `--write-info-json --write-thumbnail --embed-metadata`, **`--sponsorblock-remove`** de categorías configurables (patrocinio, autopromo, intro/outro…), límite de resolución (por defecto ≤1080p y códecs que tus dispositivos reproduzcan en directo), límite de velocidad, y filtros: omitir Shorts, directos y videos solo-miembros.
- **Programación**: por canal, cada X horas; "desde la fecha" para no bajar 10 años de golpe; **retención** (los últimos N videos o un máximo de GB).
- **Después de bajar**: pide a Jellyfin refrescar solo esa carpeta (`/Library/Media/Updated`), con la cuenta de servicio.
- **UI en Jellyflix**: lista de canales suscritos (pegas la URL), estado de cada descarga, cola, log, y "Pausar". Solo admin.
- **Mantenimiento**: yt-dlp se rompe seguido cuando YouTube cambia; el contenedor lo actualiza al arrancar y cada día (con opción de fijar versión). Cookies (para contenido con edad) opcionales, guardadas en `/data`, nunca devueltas por la API.
- **Aviso legal/ToS** que va en el README del módulo: descargar de YouTube va contra sus términos de servicio; el módulo es para archivo personal de canales que sigues, y no se distribuye lo descargado. Es decisión y responsabilidad de quien lo instala. (Ver decisión 9.)
- *Comparación honesta*: Tube Archivist hace lo básico igual; lo que mejora aquí es que **no hay otra app**: los canales viven en Jellyflix como series normales, con progreso, continuar viendo y todo.

### 6.4 Wrapped (al final)

- **Datos**: `UserData` de Jellyfin (como `core/stats.ts` hoy) + el plugin Playback Reporting si existe (hora del día, duración real). El módulo toma **instantáneas mensuales** para que el Wrapped anual no dependa de cuánto historial conserve el plugin.
- **Contenido**: horas totales, géneros, la serie que más devoraste, hora/día en que más ves, rachas, y **comparación con otra persona** — solo si ambos activan "compartir mis números" (consentimiento explícito, revocable).
- **Salida**: anual, mensual o "en vivo"; tarjetas animadas en la web y **imágenes 1080×1920** generadas en el servidor (SVG → PNG) para Instagram.
- Se aplaza porque depende de que haya meses de datos y de decisiones de diseño visual (se hará con el skill de diseño cuando llegue).

---

## 7. Fases e hitos

Tamaños como en el ROADMAP: **S** ≤ 1 día, **M** unos días, **L** ~ 1 semana o más.

### Fase 0 — Cimientos (sin ninguna función visible) · **M–L**
| # | Entregable | Notas |
|---|---|---|
| 0.1 | `modules/contract/` + sync al web + check de CI | `health`, `manifest`, versión de API |
| 0.2 | Servidor: arranque, `/v1/health`, `/v1/manifest`, auth contra Jellyfin, SQLite + migraciones, planificador de jobs, logs | sin ningún módulo todavía |
| 0.3 | Imagen Docker endurecida + `docker-compose.yml` + `.env.example` + healthcheck | igual de bloqueada que el web |
| 0.4 | Workflow de CI `modules.yml` (filtro de rutas) + publicación en ghcr (tag `modules-v*`, amd64+arm64) | el release del web no cambia |
| 0.5 | Cliente: `core/modules` (config, gate, http) + botón/ruta/página **Módulos** + panel en Settings | todo lazy |
| 0.6 | Mock de módulos para los tests e2e del web | para probar "con" y "sin" |
| 0.7 | **Pruebas de la garantía "sin contenedor"** (sección 8) | bloqueante para cerrar la fase |
| 0.8 | Docs: README de `modules/`, README/SECURITY/CHANGELOG | |

**Hecho cuando**: sin contenedor, toda la suite actual pasa *sin modificar un solo test* y el presupuesto de tamaño no se mueve; con contenedor y sin módulos activos, la página Módulos dice "No hay módulos activados" y explica cómo activarlos.

### Fase 1 — Canales · **M–L** (corte 3a del módulo)
Con el diseño nuevo ya no es el más riesgoso: no hay ffmpeg ni tuner, solo un motor de parrilla (función pura, fácil de probar), unas tablas y un cambio acotado en el reproductor. Va primero, como querías. Se entrega en tres cortes (detalle en `MODULE-CHANNELS.md`, sección 15):
- **a**: motor + modo Maratón + `now`/`guide` + guía mínima + reproductor en modo canal.
- **b**: editor con vista previa, fuentes manuales/inteligentes, asistente de canales automáticos, Parrilla semanal.
- **c**: relleno con clips, rejilla :00/:30, gráficos retro, zapping.

### Fase 2 — Match · **M–L**
Valida lo que Canales no toca: tiempo real (SSE), datos de varias personas y privacidad entre usuarios. Biblioteca primero; TMDB/Seerr después como 2.x.

### Fase 3 — Tube · **L**
Valida el planificador de jobs de verdad (descargas largas), el acceso a disco y la integración con una biblioteca de Jellyfin. No necesita pantallas nuevas para *ver* (son series), solo para gestionar suscripciones.

### Fase 4 — Wrapped · **M–L**
### Fase 5 — Paridad TV · **M**
Tube ya se ve en la TV por ser una biblioteca. Canales, Match y Wrapped necesitan pantallas nativas (para Canales, las piezas del reproductor de la TV ya existen).

> **Orden**: Canales → Match → Tube → Wrapped, como lo nombraste. Con el nuevo diseño de Canales ya no hay razón para moverlo. Es la decisión 1.

---

## 8. La garantía "sin contenedor = idéntico" — cómo se comprueba

Esto es un requisito, así que tiene tests y puertas de CI, no solo buenas intenciones:

1. **Test unitario del gate**: sin `modulesUrl`, el módulo de descubrimiento no llama a `fetch` (spy) y devuelve "ausente".
2. **Test e2e "sin módulos"**: se carga la app con el mock de Jellyfin de siempre y se verifica que **no sale ninguna petición a un origen que no sea el de Jellyfin**, que el menú no tiene botón Módulos y que `#/modules` redirige a Home.
3. **Test e2e "contenedor caído"**: URL configurada pero sin respuesta ⇒ una petición, sin toast, sin botón, y la app usable.
4. **Suite existente intacta**: el CI del web corre exactamente la misma suite; si hubiera que tocar un test viejo para que pase, es una señal de que algo se rompió.
5. **Presupuesto de tamaño**: `npm run size` sin cambios (margen de ±1 KB comentado en el PR); los chunks de módulos no entran en la primera pantalla.
6. **Imagen Docker del web**: el test de headers/CSP del CI sigue igual; con la variable vacía el `nginx.conf` efectivo es idéntico al de hoy.
7. **Aislamiento del CI**: el workflow de módulos tiene filtro de rutas; un fallo ahí no bloquea el del web, y viceversa.
8. **Un módulo roto no rompe la app**: `ErrorBoundary` por módulo y error-handling por respuesta (test: el módulo devuelve 500 ⇒ solo esa pantalla muestra el estado de error).

---

## 9. Seguridad y privacidad — cambios que hay que escribir

- **README "Privacy and principles"**: de *"Talks only to your Jellyfin server"* a *"Talks only to servers **you** run: your Jellyfin and, if you install it, your own modules container. No analytics, no third-party calls unless you turn on something that needs one."* Y *"No backend of ours"* se mantiene verdadero (el contenedor es tuyo); se aclara.
- **SECURITY.md**: el alcance dice "contactar algo distinto de tu servidor Jellyfin"; se amplía al contenedor de módulos propio. Nuevo alcance: la imagen `jellyflix-modules`, la validación de tokens, el manejo de la API key y de las cookies de yt-dlp.
- **Amenazas a cubrir con tests**:
  - Token reenviado: el módulo **nunca** lo registra ni lo guarda (solo un hash en la caché de 60 s).
  - Un usuario no admin no puede llamar a rutas de admin ni leer los swipes de otros.
  - SSRF: Tube solo acepta URLs de YouTube (lista blanca de hosts), no direcciones internas; Canales solo habla con `JELLYFIN_URL`.
  - Inyección en nombres de archivo/títulos al escribir en disco (yt-dlp `--restrict-filenames` o saneado propio).
  - La API de configuración nunca devuelve la API key, la clave de TMDB ni las cookies.
- **Cambios en terceros**: `THIRD_PARTY_NOTICES.md` suma ffmpeg y yt-dlp (licencias y cómo se empaquetan).
- **API key de Jellyfin**: el módulo la necesita para leer la biblioteca en segundo plano (parrillas de Canales, refrescos de Tube). Se documenta cómo crearla y que se puede revocar sin romper nada más. **Ningún módulo escribe en la configuración de Jellyfin** (Canales ya no registra tuner).

---

## 10. Riesgos principales

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Canales: tocar el reproductor (cola "canal" + botones) | medio | Cambio mínimo y aislado, e2e propios y toda la suite del reproductor corriendo; el motor es una función pura con tests |
| yt-dlp deja de funcionar por cambios de YouTube / términos de servicio | medio | actualización automática, versión fijable; aviso claro en el README; es opt-in |
| Que el "opcional" deje de serlo sin querer | alto | sección 8, tests bloqueantes en CI |
| Dos versiones desalineadas (web ↔ contenedor) | medio | `api` en el manifest + aviso, sin romper nada |
| Escribir en la configuración de Jellyfin sin querer | bajo | ningún módulo lo hace: Canales ya no registra tuner y Tube solo escribe en su carpeta |
| Crecimiento del bundle del web | medio | `React.lazy` + `check-size` |
| Mantener tres módulos grandes con una sola persona | medio | fases cerradas e independientes; cada módulo se puede lanzar solo |

---

## 11. Decisiones (las marcadas ✔ ya están tomadas)

> ✔ **Orden:** Canales → Match → Tube → Wrapped. ✔ **Todo en una página "Módulos"** (pestaña propia, sin tocar Inicio/Películas/Series). ✔ **Primero web**, la TV después. ✔ Canales: solo admins crean, todos ven; seguidos sin huecos; Continuar viendo como se propuso. ✔ **MVP = Fase 0 + Canales + Match**; Tube y Wrapped después de probar el MVP en tu servidor. Las demás siguen abiertas.


1. **Orden de módulos.** *Recomiendo* tu orden: Canales → Match → Tube → Wrapped. Con el nuevo diseño Canales dejó de ser el más riesgoso.
2. **Nombre.** Contenedor `jellyflix-modules`; en la UI "Módulos" / "Modules" (alternativa: "Extras"). *Recomiendo* "Módulos".
3. **Stack del contenedor.** *Recomiendo* Node 24 + TypeScript (comparte todo con el web). Alternativa: Go/Python, si prefieres.
4. **Entrega de Canales.** *Decidido en v2:* parrilla calculada + reproductor propio, sin ffmpeg ni tuner (nada corre 24/7). Quedan abiertas las 6 decisiones propias del módulo en `MODULE-CHANNELS.md` (sección 18).
5. **Una imagen vs. variantes.** *Recomiendo* una sola imagen. Si pesa mucho (ffmpeg + yt-dlp) se publica una etiqueta `:slim` sin ellos para quien solo quiera Match/Wrapped.
6. **Cómo se activan los módulos.** *Recomiendo* por variable de entorno al inicio (`JELLYFLIX_MODULES=…`) y la UI solo muestra estado y pasos de configuración; un interruptor en la UI queda para después.
7. **Proxy `/modules/` en nginx.** *Recomiendo* ofrecerlo (generado solo si hay variable) además de la URL directa.
8. **Candidatos "que aún no tienes" en Match.** ¿Aceptas depender de una clave de TMDB (gratuita) puesta por el admin? ¿Y la integración con Seerr, ahora o más adelante?
9. **Tube y los términos de YouTube.** ¿De acuerdo con que sea opt-in, con aviso explícito en el README, y sin incluir en la imagen ninguna lista de canales ni cookies?
10. **Paridad TV.** Canales ahora también necesita pantalla en la TV (en vivo ya no es "gratis"). ¿Esperamos a la Fase 5 o la TV va justo después del web de Canales?
11. **Monetización/app móvil.** Fuera de este plan (ver nota en 6.2). Dime si quieres que se estudie aparte.

---

## 12. Siguiente paso inmediato (cuando des el visto bueno)

1. Responder las decisiones 1, 3, 4 y 8 (las que cambian el trabajo de la Fase 0 y 1).
2. Empezar **Fase 0.1–0.3** en esta misma rama, con commits pequeños: contrato, esqueleto del servidor y Docker. Nada de eso es visible todavía para nadie.
3. Cerrar la Fase 0 con la sección 8 en verde **antes** de escribir una sola línea de Match.
