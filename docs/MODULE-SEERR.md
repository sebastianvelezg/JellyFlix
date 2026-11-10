# Módulo Seerr — alcance, decisiones y seguridad

> Estado (2026-11-10): **construido y probado contra un Seerr 3.5.1 real** (en local, con Jellyfin 12.4 de prueba) en la rama `feature/seerr-module` (sin commit). Versión del contenedor 0.2.0.
>
> Diseño decidido, rama `feature/seerr-module`. Sustituye a la fase 4 de `PLAN-SIETE-MEJORAS.md`: Seerr **no** va en la app principal, es un módulo del contenedor `modules/`, como Retro TV y Match, y sale como versión del contenedor. Quien no instala el contenedor (o no lo lista en `JELLYFLIX_MODULES`) no tiene nada de Seerr.

## 1. Qué hace

Dentro de la pestaña **Módulos** de Jellyflix Web:
- **Buscar** películas y series en Seerr (TMDb) con su estado: *disponible*, *parcialmente disponible*, *solicitada*, *en proceso*, *no disponible*, *bloqueada*.
- **Solicitar** una película, o una serie con elección de temporadas (todas o algunas).
- **Ver mis solicitudes** y en qué punto están, y cuánta cuota me queda.
- Si el título ya está en la biblioteca, **"Abrir en Jellyflix"**, usando el id de Jellyfin que Seerr ya conoce (`mediaInfo.jellyfinMediaId`): nunca por nombre.

No hace: administrar Seerr (aprobar, rechazar, ajustes), 4K, ni nada en la app de TV (se evaluará después).

## 2. Cómo se identifica a cada persona (la decisión que lo condiciona)

Seerr tiene dos formas de entrar: una sesión de usuario (pide su contraseña de Jellyfin, que el contenedor **no** tiene: solo recibe el token) o la **clave de API**, que además puede actuar en nombre de un usuario con la cabecera `X-API-User: <id de usuario de Seerr>` (comprobado en el código de `server/middleware/auth.ts`). Se usa la segunda:

1. La app manda su token de Jellyfin; el contenedor pregunta a Jellyfin quién es (como en todos los módulos) y obtiene su **id de Jellyfin**.
2. Con la clave de Seerr (en el contenedor, nunca en el navegador) pregunta `GET /api/v1/user/jellyfin/<id de Jellyfin>` y obtiene el **id de usuario de Seerr**. Se recuerda 10 minutos.
3. Todas las demás llamadas llevan `X-Api-Key` + `X-Api-User: <ese id>`. Seerr aplica entonces **los permisos y la cuota de esa persona**, y la solicitud queda a su nombre.

Reglas que lo hacen seguro:
- **El id de usuario sale solo de la identidad verificada de Jellyfin.** Ningún dato del cliente (cuerpo, parámetros, cabeceras) puede elegirlo. No hay un "proxy" abierto: el contenedor solo llama a un puñado de rutas de Seerr fijadas en el código.
- La clave de Seerr nunca se envía a la app, no se escribe en el registro y no aparece en ninguna respuesta.
- Una persona que no existe en Seerr (aún no importada) recibe un mensaje claro ("pide al administrador que te importe en Seerr"); el contenedor no la crea ni usa la cuenta del administrador en su lugar.
- Si la persona no tiene permiso `REQUEST`, la interfaz no ofrece solicitar; el permiso lo decide Seerr, que además lo vuelve a comprobar al solicitar.

## 3. Versión de Seerr

`GET /api/v1/user/jellyfin/{id}` existe desde **Seerr 3.3.0** (no está en 3.2.0 ni antes); la última publicada al escribir esto es la 3.5.1. Es el mínimo: el contenedor lee `/api/v1/status` y, si la versión es menor, el módulo queda en estado `error` con ese motivo. Seerr 3.2.0 también cerró `GET /api/v1/user` a las claves de API, por eso no se lista a los usuarios. Se admiten las estructuras de Seerr (no de Overseerr/Jellyseerr antiguos).

## 4. Ajustes (en el contenedor)

| Variable | Qué es |
|---|---|
| `JELLYFLIX_MODULES` | Añadir `seerr` (no está en la lista por defecto: se instala a propósito). |
| `SEERR_URL` | La dirección de Seerr **como la ve el contenedor** (por ejemplo `http://seerr:5055`). |
| `SEERR_API_KEY` | La clave de *Seerr → Ajustes → General*. |

Sin `SEERR_URL` o sin clave, el módulo aparece en `needs-setup` con lo que falta y la app no ofrece nada.

## 5. API del contenedor (la app nunca habla con Seerr)

Todas con el token de Jellyfin, y con un contrato propio y estable (no se reenvía la respuesta cruda de Seerr):

| Ruta | Para qué |
|---|---|
| `GET /v1/seerr/me` | ¿Estoy en Seerr?, ¿puedo solicitar?, cuota de películas y series. |
| `GET /v1/seerr/search?query=&page=` | Películas y series (se descartan personas), con estado y, si está, el id de Jellyfin. |
| `GET /v1/seerr/title/:tipo/:id` | Ficha: sinopsis y, en series, las temporadas con su estado. |
| `POST /v1/seerr/requests` | `{ mediaType, mediaId, seasons?: "all" \| number[] }`. |
| `GET /v1/seerr/requests?page=` | Mis solicitudes. |

Estados normalizados: `available`, `partial`, `processing`, `pending`, `none`, `blocked` (de `MediaStatus` 1 a 7 de Seerr; `status4k` se ignora; "borrada" cuenta como `none`).

## 6. Seguridad y límites

- Validación estricta de entradas: `mediaType` ∈ {movie, tv}; ids enteros positivos; `seasons` "all" o hasta 100 enteros 0-100; `query` 1-200 caracteres; `page` 1-1000.
- Se piden a Seerr solo esas rutas, con tiempo máximo de 15 s y un tope de tamaño de respuesta; un error de Seerr se traduce a un mensaje en inglés sin reenviar su texto ni su dirección.
- Límite de solicitudes por persona (10 al minuto) y de búsquedas (60 al minuto), para que una cuenta no sature a Seerr.
- Los errores de Seerr se traducen: duplicada (409), sin permiso (403), cuota agotada (409 con cuándo se renueva si Seerr lo dice), Seerr caído (502).
- Nada se guarda en la base de datos del contenedor salvo la memoria de 10 minutos del emparejamiento, que está en memoria.
- Prueba de seguridad: la clave no aparece en ninguna respuesta, en ningún mensaje de error ni en el registro; no se puede alterar el `X-Api-User`.

## 7. En la web

Una página `#/modules/seerr` (como `#/modules/match`): campo de búsqueda, rejilla con insignia de estado, panel de la ficha (temporadas con casillas), botón *Solicitar*, lista *Mis solicitudes* con la cuota. Los textos van en los cinco idiomas y la página es accesible con teclado. Solo aparece si el manifiesto lista `seerr` en estado `ready`.

## 8. Pruebas

- **Contenedor:** un Seerr de mentira (`test/fakeSeerr.ts`, como `fakeJellyfin.ts`) con los estados y errores: el emparejamiento por id de Jellyfin, el actuar en nombre de otro usuario, permisos, cuota, duplicada, caído, versión antigua. Pruebas de las rutas y de que la clave nunca sale.
- **Web:** pruebas de la página con el contenedor simulado y un e2e con el servidor de pruebas.
- **Pendiente de una instancia real de Seerr** (3.3 o posterior): comprobar a mano la búsqueda, una solicitud y la cuota, con dos cuentas.

## 9. Preguntas abiertas

1. ¿Tienes una instancia de Seerr para probar (o permiso para levantar una en Docker)?
2. ¿Solicitudes en 4K? Por ahora no.
3. ¿"Mis solicitudes" también para el administrador con todas (permiso `MANAGE_REQUESTS`)? Por ahora solo las propias, y la gestión se hace en Seerr.

## 10. Qué se construyó y qué se comprobó (2026-11-10)

- **Contenedor** (`modules/server/src/modules/seerr/`): `client.ts` (rutas fijas, tiempo máximo, sin seguir redirecciones, errores traducidos sin pasar el texto de Seerr), `normalize.ts` (todo se lee, se comprueba y se corta), `service.ts` (emparejamiento por id de Jellyfin, actuar como esa persona, límites, estado de salud), `routes.ts` (validación estricta). 27 pruebas con un Seerr de mentira (`test/fakeSeerr.ts`), incluida la de que la clave no sale en ninguna respuesta y la de que el id de usuario no lo puede elegir el cliente.
- **Hallazgo durante la construcción:** el manifiesto consultaba a Seerr y la app solo espera 2,5 s: un Seerr lento habría hecho desaparecer **todos** los módulos. Ahora la salud de Seerr se pregunta con 1,5 s de paciencia, una pregunta a la vez, y se contesta al instante con la respuesta anterior mientras se renueva. Con prueba.
- **Web:** `core/modules/seerr.ts`, `components/modules/seerr/SeerrPage.tsx` (buscar, ficha con temporadas, solicitar, mis solicitudes, cuota; las búsquedas viejas que llegan tarde se descartan), textos en 5 idiomas, 8 pruebas de página, pruebas del cliente y de la ruta, y un e2e contra el contenedor real y el Seerr de mentira (con accesibilidad con axe en 4 pantallas).
- **Pendiente:** probar con el Seerr de tu servidor (los contenedores de prueba no tienen biblioteca, Radarr ni Sonarr: no se vio "disponible", ni "abrir en Jellyflix", ni una cuota con límite); decidir si "Mis solicitudes" debe mostrar todas a quien gestiona solicitudes; 4K.

## 11. Prueba contra un Seerr real (2026-11-10)

Contenedores de usar y tirar en el PC (Jellyfin 12.4.0 vacío y Seerr 3.5.1, en una red de Docker propia y en puertos 18096 y 15055), con una cuenta de administrador y una normal, el contenedor de módulos real y la web real en el navegador. Se vio funcionar: el módulo listo en el manifiesto, la búsqueda (con los carteles de TMDb), la ficha, pedir una película y varias temporadas, "Mis solicitudes", y que Seerr guarda cada solicitud **a nombre de la cuenta que la hizo** (la normal es el usuario 2, la de administrador el 1, que se aprueba sola).

Lo que el Seerr real enseñó y el de mentira no (corregido, con pruebas):
1. **Una búsqueda de varias palabras fallaba (HTTP 400).** Seerr exige los espacios como `%20` y rechaza el `+` que genera `URLSearchParams`. Ahora la dirección se construye con `encodeURIComponent`, y el Seerr de mentira también rechaza el `+`.
2. **Las temporadas ya pedidas seguían apareciendo como "no están".** Seerr no las marca en `mediaInfo.seasons` mientras no llegan: están en `mediaInfo.requests[].seasons`. Ahora una temporada pedida sale como "esperando aprobación" (o "en camino" si está aprobada) y no se puede pedir otra vez.
3. **Pedir temporadas ya pedidas devuelve "ok" sin crear nada.** El módulo lo dice como "ya se pidió" en vez de dar una solicitud con número 0.
4. (Del repaso) un cartel que no carga deja el nombre en un recuadro, y en "Mis solicitudes" no se repite la misma etiqueta dos veces.

No se pudo ver con estos contenedores: "en tu biblioteca" y "Abrir en Jellyflix" (no hay medios), una cuota con límite y Radarr/Sonarr.
