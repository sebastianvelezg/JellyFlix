# Módulo Canales ("Retro TV") — alcance y funcionamiento

> Segunda versión del diseño. Sustituye a lo que decía `MODULES-PLAN.md` en la sección 6.1 (tuner M3U/XMLTV + ffmpeg).
> Sigue siendo solo un plan: no hay código. Rama: `feature/modules-container`.

---

## 1. La idea en una frase

**Una televisión de mentira que solo existe cuando la miras.** Cada canal es una *parrilla calculada*: una lista de "a esta hora toca este título". Nada se emite, nada corre en segundo plano. Cuando alguien sintoniza un canal, Jellyflix consulta *qué toca ahora y en qué minuto*, y reproduce ese título con el reproductor de siempre, empezando en ese minuto.

Ejemplo: son las 20:17, el episodio de "Canal Anime 24/7" empezó a las 20:00. Entras al canal y ves ese episodio desde el minuto 17, como en una TV real. Si lo prefieres, pulsas **Empezar desde el principio**. Si no te gusta, pulsas **Siguiente**.

## 2. Por qué cambia el diseño

| | Diseño anterior (tuner M3U + XMLTV) | Diseño nuevo (parrilla + reproductor propio) |
|---|---|---|
| Qué es un canal | Un stream de ffmpeg que "emite" | Una fila de horarios en una base de datos |
| Recursos con nadie viendo | Casi nada, pero hay infraestructura lista para arrancar | **Nada** (salvo un job diario de segundos) |
| Recursos viendo | ffmpeg + Jellyfin re-procesando el stream en vivo + el cliente | **Lo mismo que ver una película normal** (Jellyfin la sirve igual que siempre) |
| "Empezar desde el principio" | Imposible (un stream en vivo no se rebobina por espectador) | Natural |
| "Siguiente episodio" | Imposible | Natural |
| Cortes entre programas | Los tapa ffmpeg | 1–3 s de carga entre programas (se puede precargar) |
| Hay que tocar Jellyfin | Sí (registrar tuner y guía) | **No.** No se escribe nada en Jellyfin |
| Se ve en otros clientes de Jellyfin | Sí | No: solo en Jellyflix |
| Se ve en la app de TV | Gratis, por el Live TV | Necesita pantalla nueva en la TV (fase aparte) |

Lo que perdemos (verse en otros clientes y "gratis" en la TV) es poco para el uso real: tú y tu casa usando Jellyflix. Lo que ganamos es justo lo que pediste: coste cero en reposo y control total del "retro" (empezar de nuevo, saltar, guía propia).

## 3. Qué corre y cuándo

| Momento | Qué pasa | Coste |
|---|---|---|
| Nadie mira, de día o de noche | **Nada.** | 0 |
| Una vez al día (y al guardar un canal) | Un job rellena la parrilla de los próximos 7 días: consultas a la base de datos y a Jellyfin, sin tocar video | segundos de CPU, sin disco ni red apreciables |
| Alguien sintoniza un canal | Una petición pequeña (JSON): "qué toca ahora + los próximos 5" | milisegundos |
| Alguien está viendo | El reproductor normal reproduce un título (direct play o transcodificación **de Jellyfin**, como cualquier película). El módulo no participa | igual que ver esa película sin canales |
| Cambia el programa | El cliente ya trae los próximos programas; solo repite la consulta si le quedan pocos | casi 0 |

No hay ffmpeg en este módulo. No hay procesos por canal. Tener 5 o 100 canales cuesta lo mismo en reposo: filas en SQLite (≈ 100 canales × 48 programas/día × 7 días ≈ 34 000 filas, una estimación, es muy poco).

## 4. Cómo se define un canal

Un canal tiene: **nombre, número, logo/color, fuentes, modo de programación y reglas**.

### 4.1 De dónde salen los títulos (fuentes)

Puedes combinar varias fuentes en un mismo canal:

- **Lista manual**: eliges a mano películas, episodios, temporadas, series completas, colecciones o listas de reproducción de Jellyfin, y las ordenas arrastrando. Esto es lo que pediste: "pasarle una lista de episodios, temporadas, series, películas".
- **Regla inteligente**: género, biblioteca, etiqueta, década, rango de años, clasificación por edad, estudio, duración mínima/máxima, "solo no vistas", texto en el título.
- **Una serie "en orden"**: por ejemplo, Los Simpson capítulo tras capítulo desde el que toca, como en la TV real (ver el *cursor* en 5.3).
- **Una lista de Jellyfin** (playlist) como fuente directa: es lo más rápido para armar un canal con lo que ya tienes.

### 4.2 Asistente de canales automáticos

Para "bastantes canales, bastantes géneros" sin crearlos uno por uno: un asistente que propone un canal por cada género, década o colección de tu biblioteca ("Acción", "Años 80", "Marvel", "Anime clásico"), con valores por defecto sensatos. Tú marcas cuáles quieres y se crean de golpe. Después puedes editar cada uno. Como un canal en reposo no cuesta nada, tener 40 canales no es un problema.

### 4.3 Dos modos de programación

**Maratón (por defecto, el más simple).** Los títulos se ponen en una secuencia (orden fijo, mezcla con semilla, o intercalando series: un episodio de A, uno de B…) y el canal los emite uno tras otro, para siempre. Al acabar la secuencia se vuelve a mezclar (con la semilla del ciclo siguiente) o se repite. Sirve para "Canal Anime 24/7".

**Parrilla semanal.** Una plantilla de bloques horarios, cada uno con su fuente: *sábados 16:00–22:00 → colección Marvel; todos los días 00:00–04:00 → terror; lunes a viernes 19:00–21:00 → comedias*. Cada día se rellena con un sorteo con semilla (misma semilla ⇒ mismo resultado) que evita repetir lo que salió hace poco.

### 4.4 Opciones de estilo "TV real"

- **Alinear a la rejilla** (ninguna / 15 / 30 / 60 min): los programas empiezan en :00 y :30. El hueco entre el final de un episodio de 22 min y el :30 se rellena con *relleno* (siguiente punto). Por defecto, **ninguna** (todo seguido, sin huecos).
- **Relleno ("comerciales")**: eliges una biblioteca o colección de Jellyfin con clips tuyos (comerciales retro, trailers, cortos). El módulo los usa para tapar los huecos. Se reproducen como títulos normales de Jellyfin: no se genera nada y no se distribuye material con copyright.
- **Detalles de pantalla** (los hace el cliente, no el servidor): el número de canal en una esquina al sintonizar, la "marca de agua" con el logo del canal, y una barra "A continuación: …". Son gráficos del reproductor, no videos.
- **Sin repetir demasiado**: una regla "no repetir un título antes de N programas/días".

## 5. La parrilla: cómo se guarda y se mantiene

### 5.1 Línea de tiempo materializada
La parrilla no se calcula "con matemáticas" cada vez: se guarda como filas `(canal, empieza, termina, título, tipo)` para los próximos 7 días, y se alarga todos los días. "¿Qué toca ahora?" es una consulta con un índice. Ventajas: es fácil de depurar, de mostrar en la guía y de probar.

### 5.2 Ventana congelada
Lo que está sonando ahora y las próximas ~2 horas **no cambian** aunque edites el canal o cambie la biblioteca; los cambios afectan desde ahí en adelante. Así nadie ve que "su" episodio cambia a mitad. (Si editas un canal, un botón "Aplicar ya" reconstruye desde este momento.)

### 5.3 Cursor de serie
En los canales que van "en orden" por una serie, el canal recuerda por qué episodio va. Cada día que se alarga la parrilla, avanza el cursor. Así Los Simpson avanzan episodio a episodio con los días, como una sindicación real, y no empiezan siempre por el capítulo 1.

### 5.4 Qué pasa si la biblioteca cambia
- Una vez al día (y con el botón "Actualizar") el módulo relee la lista de títulos de cada fuente.
- Si un título programado desaparece, el cliente lo salta al sintonizar (ver 6.4) y la parrilla lo corrige en la siguiente pasada.
- Un título sin duración conocida en Jellyfin no entra (la duración es la base de todo el cálculo).

## 6. Cómo es ver un canal

### 6.1 Sintonizar
1. Entras a **Canales** (guía) o cambias de canal con ▲▼ desde el reproductor.
2. El cliente pide `ahora` → `{ título, empieza, termina, minuto actual, siguientes 5 }`.
3. Abre el reproductor en modo canal, en ese minuto. El número de canal aparece unos segundos en una esquina.

### 6.2 Controles del modo canal

| Botón | Qué hace |
|---|---|
| **Empezar desde el principio** | Vuelve al inicio del programa actual. Pasas a estar "atrasado" respecto al canal en vivo |
| **Siguiente** | Salta al comienzo del siguiente programa (puedes encadenar varios) |
| **Anterior** | Vuelve al comienzo del programa anterior |
| **Ir en vivo** | Aparece solo si no estás en vivo. Te devuelve a lo que "toca ahora" |
| **▲ / ▼** | Canal siguiente/anterior (zapping), con el número en pantalla |
| **Guía** | Abre la rejilla de programación sin salir del reproductor |
| Barra de progreso | Funciona como siempre. Si te mueves en la barra, simplemente estás adelantado o atrasado |

Un indicador pequeño dice **"En vivo"**, **"14 min atrasado"** o **"22 min adelantado"**.

### 6.3 La regla que lo hace simple: "mi posición" es el único estado
Para el canal, tú estás en un punto de su línea de tiempo: `posición = programa + minuto`. Estar "en vivo" es que esa posición sea igual a la hora actual. Todo lo demás se deduce:

- *Empezar desde el principio* = mover tu posición al inicio del programa actual.
- *Siguiente* = mover tu posición al inicio del programa siguiente.
- *Ir en vivo* = mover tu posición a la hora actual.
- *Mover la barra* = mover tu posición.

No hay un estado "atrasado" que guardar ni sincronizar: es solo la diferencia entre tu posición y el reloj. Dos dispositivos en vivo ven lo mismo, sin hacer nada (la hora es la misma). Si sales del canal y entras otra vez, **vuelves a estar en vivo** (como pediste: "cuando uno entra, empieza donde debería ir").

### 6.4 Cuando acaba un programa
El cliente pasa solo al siguiente de la línea de tiempo, al comienzo. Si estás en vivo y la diferencia con la hora real es pequeña (< ~20 s, por pequeñas diferencias de duración entre el archivo y Jellyfin), se ajusta a "en vivo" sin que lo notes. Si el siguiente título no se puede reproducir (borrado, sin permiso, bloqueado por el modo niños), se salta *solo para ti*.

### 6.5 Si el contenedor de módulos se cae mientras ves
Sigues viendo: lo que se reproduce es Jellyfin, no el módulo. El cliente ya tiene los próximos programas descargados. Si se acaban y el módulo sigue caído, el reproductor se detiene con un mensaje claro.

## 7. Pantallas

1. **Guía (Módulos → Canales)**: una rejilla clásica de TV (canales en filas, horas en columnas), con el programa actual resaltado. Clic en un programa de ahora = sintonizar. Clic en uno futuro = detalles (y "recordármelo" en una fase posterior). Muestra "ahora" y "a continuación" también en versión móvil como lista.
2. **Editor de canal**: nombre, número, logo/color, fuentes (con buscador y arrastrar), modo, bloques horarios, relleno, rejilla, repetición. Con **vista previa de la parrilla** de los próximos días *antes* de guardar.
3. **Asistente de canales automáticos** (4.2).
4. **Reproductor en modo canal** (6.2).

La parte de gestión (crear, editar, borrar) es solo para administradores o para quien se decida (ver decisiones). Ver los canales es para cualquier usuario.

## 8. Qué cuenta como "visto" y qué pasa con Continuar viendo

Es una decisión delicada, porque reproducir un título "por el canal" también escribe en Jellyfin.

- **Cuenta como reproducción** (para que Wrapped y Estadísticas lo vean): sí.
- **Continuar viendo**: no queremos que cada visita a un canal deje a medias un título en tu lista. Propuesta: en modo canal, al salir **antes del final** se informa a Jellyfin con posición 0 (no queda para reanudar); al llegar al final normal sí se marca como visto.
- A comprobar en un servidor real durante la construcción (Jellyfin marca "visto" según su propio umbral de porcentaje). Hay una decisión abierta para esto.

## 9. Permisos y modo niños

- Cada espectador usa su **propio** token de Jellyfin: lo que no puede ver, no se reproduce (Jellyfin lo niega).
- El **modo niños** (clasificación máxima, con PIN) ya existe: en un canal, los programas por encima de la clasificación se **saltan** para ese espectador.
- Los canales los ven todos los usuarios, pero la lista de qué contiene cada uno se filtra para cada quien.

## 10. API (contrato `/v1/channels`)

| Método y ruta | Quién | Para qué |
|---|---|---|
| `GET /channels` | usuario | Lista de canales (número, nombre, logo) |
| `GET /channels/:id/now?count=5` | usuario | Programa actual, minuto actual y los siguientes |
| `GET /guide?from=&to=` | usuario | La rejilla de varios canales para una franja horaria |
| `POST /channels` / `PUT /channels/:id` / `DELETE` | admin | Crear, editar, borrar |
| `GET /channels/:id/preview?days=3` | admin | Vista previa de una definición sin guardarla |
| `POST /channels/:id/rebuild` | admin | "Aplicar ya" / actualizar la parrilla |
| `POST /channels/auto` | admin | El asistente (4.2) |

No hay ninguna ruta que transmita video. El cliente reproduce siempre contra Jellyfin.

## 11. Datos (SQLite en `/data`)

- `channels` — definición (JSON de fuentes y reglas, modo, semilla, número, logo, rejilla, relleno).
- `pool_items` — caché de los títulos de las fuentes: id, tipo, serie/temporada/episodio, duración, clasificación, géneros. Se rellena una vez al día.
- `programs` — la línea de tiempo: `(channel_id, starts_at, ends_at, item_id, kind: 'program'|'filler')`.
- `channel_cursor` — por canal, por qué título/episodio va cada serie en orden.

Los tiempos se guardan en UTC; la parrilla semanal usa una zona horaria configurable (por defecto la del contenedor).

## 12. Cómo encaja en lo que ya existe

- **El reproductor ya sabe** reproducir desde un segundo concreto (`#/play/<id>?start=<seg>`) y seguir con "el siguiente título de una cola" (`PlayQueueRef`, `orderQueue`, `nextInQueue`). Agregamos un tipo de cola nuevo, "canal", cuyo siguiente título lo da la parrilla, más los botones del 6.2. Es **el único código delicado que se toca**, así que va con tests de e2e propios.
- **Live TV de Jellyfin y de Jellyflix quedan intactos.** Los canales retro son otra sección ("Canales", dentro de Módulos), para no mezclar la TV real con la de mentira.
- **La lógica de la parrilla es una función pura** (`buildTimeline(definición, títulos, cursor, desde, hasta, semilla)`), sin red ni reloj propios, con tests de Node. Misma entrada, misma salida.
- **Nada se registra en Jellyfin.** Quitar el módulo no deja nada que limpiar.

## 13. La app de TV y otros clientes

- Otros clientes de Jellyfin (web oficial, Infuse…) **no** verán estos canales.
- La app de TV de Jellyflix necesita su pantalla de canales (guía + reproducir desde un minuto + los botones del 6.2). Todo lo necesario ya existe en el reproductor de la TV (empezar en un punto, siguiente título). Va en una fase propia, después de que el web esté probado.

## 14. Fuera de alcance (a propósito)

- Emitir video desde el módulo (ffmpeg, HLS, tuner M3U/XMLTV, DVR).
- Que los canales aparezcan en el Live TV de Jellyfin.
- Cortinillas o comerciales *generados* como video. Solo gráficos en el reproductor y clips de relleno que pones tú.
- "IA" que arme canales: queda como idea posterior (reglas + pesos con tu historial primero; un modelo externo, opcional, con tu propia clave, mucho después).
- Varios usuarios con *distinta* programación del mismo canal.

## 15. Fases

| Corte | Qué entrega | Tamaño | Hecho cuando |
|---|---|---|---|
| **3a** | Motor puro + modo Maratón + tablas + `now`/`guide` + guía mínima + reproductor en modo canal (sintonizar, empezar desde el principio, siguiente, ir en vivo, avance automático) | M–L | Con 3 canales de prueba en el mock, se sintoniza, se salta y se vuelve en vivo; los tests del motor y un e2e pasan; en reposo no corre nada |
| **3b** | Editor con vista previa, fuentes manuales/inteligentes/playlist, asistente de canales automáticos, modo Parrilla semanal, cursor de serie, ventana congelada | M | Se pueden crear 20 canales de géneros con un clic; editar un canal no mueve lo que suena |
| **3c** | Relleno con clips, rejilla 15/30/60, gráficos retro (número, marca de agua, "a continuación"), zapping ▲▼, ajustes de "visto" | S–M | Cumple 8 y 4.4 |
| **TV** | Pantalla de canales en la app de TV | M | Fase de paridad con la TV |

## 16. Tests

- **Motor** (Node, sin red): determinismo (misma semilla, misma parrilla), sin solapes ni huecos (salvo rejilla), respeta la ventana congelada, avanza el cursor, no repite antes de N, reparte bloques de la semana, maneja títulos sin duración y huecos de rejilla.
- **Servidor**: permisos (usuario no puede crear/borrar), `now` correcto con el reloj simulado, sin rutas que devuelvan video.
- **Cliente**: sintonizar y empezar en el minuto correcto, *Empezar desde el principio / Siguiente / Ir en vivo* mueven la posición como se describe, salto de un título no reproducible, caída del módulo en mitad del programa.
- **Recursos**: un test que verifica que sin peticiones al módulo no hay trabajo programado salvo el job diario.
- **Garantía "sin contenedor"** (sección 8 del plan general): igual que los demás módulos.
- i18n (inglés/español) y accesibilidad (axe) en la guía, el editor y los controles.

## 17. Riesgos

| Riesgo | Mitigación |
|---|---|
| El código del reproductor es el más delicado de la app | Cambio mínimo y aislado (tipo de cola + botones), e2e específicos, ejecutar toda la suite del reproductor existente |
| Pequeñas diferencias de duración entre archivo y Jellyfin descuadran la hora | Ajuste a "en vivo" si la diferencia es corta (6.4); las duraciones vienen de Jellyfin |
| Cargas de 1–3 s entre programas | Precargar el siguiente título en el cliente (fase 3c) |
| Contaminar Continuar viendo | Decisión 8 (propuesta en la sección 8) |
| Cambio de biblioteca mueve la parrilla | Ventana congelada + parrilla materializada (5.2) |

## 18. Decisiones tomadas (2026-11-06)

1. **Quién crea canales:** solo administradores; todos los usuarios los ven y los sintonizan.
2. **Continuar viendo:** como se propuso (sección 8): cuenta como visto, pero salir a medias no deja el título en "Continuar viendo".
3. **Alineación:** siempre **seguidos, sin huecos**. Cuando acaba un programa empieza el siguiente. La rejilla :00/:30 y el relleno quedan fuera del MVP.
4. **Maratón por defecto:** series en orden (episodio tras episodio), mezcladas con las demás series y las películas.
5. **Anterior:** se incluye.
6. **TV:** primero se termina y se prueba todo en la web; la app de TV recibe después su pestaña "Módulos" con las mismas pantallas.
7. **Dónde vive:** una página nueva "Módulos" (pestaña propia). No toca Inicio, Películas, Series, etc.
8. **Nada en reposo:** la parrilla se alarga **bajo demanda** (cuando alguien la pide) usando la lista de títulos guardada, no con un proceso permanente. Solo refrescar la lista de títulos desde Jellyfin necesita acceso a Jellyfin (botón de admin, o de noche si hay API key).
