# Plan de siete mejoras en cuatro fases

Estado (2026-11-09): **la fase 1 está construida en la rama `feature/tv-profiles` (sin commit) salvo lo de Google Play, que se **aparcó por decisión del usuario** (1.5-1.7 y el spike S5): por ahora no se publica nada y se sigue distribuyendo el APK como hasta ahora.** Las fases 2 y 3 también están construidas; la 4 (Seerr) pasó a ser un módulo (2026-11-10). Sobre `main` en `6706a37`, versión 1.5.0. **Las cuatro fases salen juntas en una sola versión, la 1.6.0** (decisión del 2026-11-09; las versiones 1.7-1.9 que aparecían antes ya no existen). Cada entrega se puede probar sola, y termina con tests, textos en los cinco idiomas web (y EN/ES en TV) y la comprobación de accesibilidad (`e2e/a11y.spec.ts`).

Leyenda de dependencias: **J** = depende de Jellyfin (versión/servidor), **S** = depende de Seerr, **P** = depende de Google Play / Play Console. Tamaños: S = un día o menos, M = unos días, L = una semana o más.

---

## 1. Lo que encontré al revisar el código

### Sesión y cuentas (mejoras 1, 7 y la base de 4, 5 y 6)

- **TV guarda una sola sesión.** `tv/.../data/SessionStore.kt` guarda `server`, `tokenSealed` (cifrado con Keystore, `KeystoreVault`), `userId` y `userName` en el fichero de preferencias `session`. `AppViewModel.signOut()` (líneas ~552-582) borra la sesión y reinicia a mano unas 30 variables de estado (home, bibliotecas, música, Live TV, Watch Next, caché de inicio, módulos, mando remoto).
- **Casi todo lo demás ya es "del dispositivo", no "de la cuenta".** Los ajustes (`pref.*`), el aspecto (`look.*`) y `autoplayNext` sobreviven al cierre de sesión. Lo que sí se borra al salir (`seriesTracks`, `lastChannel`) está indexado por serie o canal, no por usuario: con dos cuentas se mezclarían. `startVisit` ("Nuevo desde tu última visita") tampoco distingue usuarios. `HomeCache` es un único fichero.
- **La web ya resolvió esto para su caso:** `web/src/platform/web/owner.ts` guarda búsquedas recientes, pistas por serie, última visita y progreso de libros bajo `clave:userId`. TV necesita el equivalente.
- **El `DeviceId` de TV es fijo** (`"jellyflix-tv"`, `JellyfinRepository.kt` líneas ~814 y ~1326). Con varias cuentas hay que comprobar cómo lo trata Jellyfin 12.2 (ver spike S1).
- **Un 401 hoy cierra la sesión entera:** `fail()` llama a `signOut()` (`AppViewModel.kt:1985`). Con perfiles debe afectar solo a esa cuenta.
- **Google TV "Watch Next"** (`WatchNext.kt`) escribe en una base de datos del *launcher*, compartida por toda la casa. Con perfiles, "Continuar viendo" de una persona aparecería en la pantalla de inicio de todos. Es un riesgo de privacidad que hay que decidir en 1.2.
- **Quick Connect existe en ambos clientes.** Web: `core/quickConnect.ts` (iniciar, comprobar, completar y `authorizeQuickConnect` para aprobar un código desde una sesión abierta; la UI de aprobación está en Ajustes). TV: `quickConnectStart/Approved/Finish` en `JellyfinRepository.kt` y `AppViewModel.startQuickConnect` (consulta cada 2 s hasta 10 min, sin botón para pedir otro código al vencer). TV ya tiene `QrImage.kt` y `SessionStore.webAddress` (la dirección de Jellyflix Web, hoy usada para el QR de Match).
- **PIN:** la web ya tiene PIN con sal y espera creciente tras fallos (`hashPin`, `verifyPin`, `waitAfterFailures` en `core/parental.ts`, estado en `platform/web/kids.ts`), con la advertencia honesta de que protege la app y no el servidor. TV no tiene nada equivalente.

### Publicación (mejora 2)

- `applicationId = "app.jellyflix.tv"`, `targetSdk 37`, `minSdk 28`, versión 1.5.0 / código 25. `release` se firma con tu clave si existe `keystore.properties`, si no con la de depuración. CI (`release.yml`) solo ejecuta `assembleRelease`: **no hay `bundleRelease` (AAB)**, que es lo que exige Play.
- La clave de firma publicada está en `MyJellyfin/signing/jellyflix.jks` (copia de seguridad: tuya). Mis notas de octubre dicen que el APK de la v0.4.0 se verificó con CN=Jellyflix y huella SHA-256 `5350bd57…f915c`; **hay que volver a verificarlo sobre el APK de 1.5.0** antes de decidir nada.
- Bibliotecas nativas del APK de release: solo `libandroidx.graphics.path.so` (4 ABI). El requisito de 64 bits y páginas de 16 KB de Play para TV (a partir del 1 de agosto de 2026, según la guía de calidad de TV de Android) hay que comprobarlo con `zipalign -P 16` / `check_elf_alignment`; el riesgo parece bajo, pero no está comprobado.
- `AndroidManifest.xml` ya declara `LEANBACK_LAUNCHER`, banner y `touchscreen required=false`. Tiene `usesCleartextTraffic="true"` (LAN con http) y `WRITE_EPG_DATA`, que Play preguntará en la revisión.

### "Continuar viendo" y "Siguiente" (mejora 4)

- Web: `getContinueAll` (`core/home.ts:116`, una consulta por tipo) y `getNextUp` (`core/shows.ts:149`). TV: `JellyfinRepository.kt` líneas ~321 y ~331.
- **El SDK instalado (1.0.2, `getResumeItems` y `getNextUp`) no tiene ningún parámetro para excluir ni ocultar elementos** del lado del servidor: ni `excludeItemIds`, ni "ocultar de reanudar". Jellyfin solo ofrece poner la posición a cero o marcar como visto, justo lo que no queremos. Por tanto **la ocultación debe vivir en el cliente, por cuenta**, y filtrar en el repositorio (para que lo respeten todas las pantallas que leen estas filas, incluido Watch Next).
- Menús de tarjeta: web `CardMenu.tsx` (+ `cardActions.ts`); TV `LocalCardMenu` / `DialogSpec` en `ui/Dialogs.kt` (pulsación larga).

### Autoplay (mejora 5)

- Web: `core/upNext.ts` (fases `hidden/preview/counting/waiting`), `PlayerStage.tsx:190-253` (`useUpNext`, cuenta atrás de 8 s configurable, interruptor `autoplayNext`). Los vídeos musicales en "flujo" usan una cuenta de 3 s.
- TV: `MainActivity.kt:170` decide `if (continues && vm.autoplayNext) vm.playNext(page.plan)`; no hay cuenta atrás ni tarjeta.
- No existe ningún contador de episodios seguidos ni temporizador de apagado en vídeo (en música sí hay `sleep timer`, `MusicPlayer`, reutilizable como idea).

### Sincronización de ajustes (mejora 6)

- **El mecanismo de copia existente sí admite este uso.** Web: `core/displayPrefs.ts` guarda un texto en `CustomPrefs["settings"]` de las preferencias de pantalla del usuario (id/cliente `jellyflix`); `platform/web/settingsBackup.ts` define el formato `{app:'jellyflix', version:1, settings:{…}}` con una lista blanca de claves y saneado. TV (`AppearanceBackup.kt`) ya lee y escribe **el mismo fichero** (solo `jellyflix.appearance`) y conserva lo que no entiende. Hoy es manual (botones guardar/cargar) y de un solo uso.
- Ya existe la separación pedida: TV tiene preferencias de pantalla (`TvSettings`: margen, tamaño de texto, límite de bitrate) distintas del aspecto (`Appearance`: lienzo, acento, orden de menú, filas del inicio, tamaño de póster).
- Límite del servidor: `MAX_SETTINGS_CHARS = 200 000`, y `UpdateDisplayPreferences` reemplaza el DTO completo (hay que leer–modificar–escribir).

### Seerr (mejora 3)

- No hay nada de Seerr en el código. El `ROADMAP.md` lo dejaba "para después del plugin", y el plugin se aparcó.
- Ya existe un contenedor opcional propio, `modules/` (Node), que **valida el token de Jellyfin del llamante** (`modules/server/src/auth/auth.ts`, con límite de tokens rechazados por minuto y `JELLYFLIX_TRUST_PROXY`). Es el candidato natural para hacer de intermediario si Seerr no admite llamadas directas del navegador.
- La web promete "no cargar nada que no sea tu servidor" (decisión 2.6 del roadmap): una conexión directa a Seerr desde el navegador es una excepción que hay que declarar y que el usuario active.

### Cosas de la revisión que condicionan todo

- `AppViewModel.kt` tiene 2 000 líneas y `JellyfinRepository.kt` 1 755. Perfiles y ocultación tocan ambos. Conviene **extraer** (`ProfileStore`, `AccountState.reset()`) en vez de añadir más líneas.
- El servidor real (Jellyfin 12.2.0) devolvió 401 a clientes revocados durante las pruebas del administrador: el caso "una sesión revocada" ya ocurre en la práctica.
- El emulador `Television_1080p` tiene tu sesión real: **las pruebas de TV usan `Television_test`**, y el mock web no puede iniciar sesión en TV (ids no UUID) salvo con el proxy de ids de las pruebas anteriores.

---

## 2. Decisiones de diseño que atraviesan las fases

1. **Formato de ajustes versionado.** Pasar el fichero de `version: 1` a una envoltura compatible: `version` sigue siendo 1 para el contenido que ya existe, y los datos nuevos van en secciones con su propio número (`sections.appearance.v`, `sections.hidden.v`, …). Un cliente antiguo ignora secciones desconocidas y, al guardar, las conserva (la regla que ya cumple `AppearanceBackup.merge`). Hay que añadir esa regla de "conservar lo desconocido" también al lado web (`exportSettings` hoy reescribe desde `localStorage`).
2. **Identidad de cuenta = `serverUrl + userId`.** Todo estado de cuenta (pistas por serie, última visita, ocultos, caché) se guarda bajo esa clave, en TV igual que en web (`owner.ts`).
3. **Lo ocultado y lo sincronizado no son lo mismo que lo guardado en el servidor.** Mientras Jellyfin no tenga API, "ocultar" es una preferencia de cliente por cuenta; en la fase 3 puede viajar con la sincronización.
4. **Seguridad:** ningún PIN, token ni contraseña viaja en el fichero de ajustes, en un QR ni en el intermediario de Seerr. El PIN local protege la interfaz, no el servidor; los permisos de contenido siguen siendo los de Jellyfin.

---

## 3. Spikes previos (media jornada cada uno, antes de escribir código)

| # | Qué se comprueba | Por qué | Cómo |
|---|---|---|---|
| S1 | Jellyfin 12.2: ¿se pueden tener dos usuarios con el **mismo** `DeviceId`? ¿Un inicio de sesión de la cuenta B revoca el token de A? ¿Cómo aparecen en el panel de dispositivos? | Si lo revoca, hay que usar un `DeviceId` por perfil (`jellyflix-tv-<instalación>-<userId8>`) | Dos cuentas de prueba en un Jellyfin 12.2 en Docker (no tu servidor), dos autenticaciones y una petición con cada token |
| S2 | Quick Connect: ¿existe una página de Jellyfin Web que acepte un código por URL? ¿Qué devuelve `getQuickConnectState` (se ve nombre del dispositivo)? ¿Cuándo vence un código? | Decide el destino del QR (ver 1.1) | Jellyfin 12.2 en Docker + lectura de su OpenAPI (`/api-docs/openapi.json`) y del código de `jellyfin-web` |
| S3 | Parámetros reales de `Items/Resume` y `Shows/NextUp` en 12.2 (el SDK 1.0.2 podría ir por detrás) | Confirmar que no hay "ocultar de reanudar" nativo | Leer la OpenAPI de 12.2 |
| S4 | Seerr: modos de autenticación (cookie de sesión por inicio con Jellyfin, API key de administrador), CORS, forma exacta del cuerpo de `POST /request` para temporadas, cuotas y errores | Decide conexión directa o intermediario (ver 4.1) | Seerr en Docker contra el mismo Jellyfin de prueba y su `seerr-api.yml` |
| S5 · APARCADO | Firma y canal: huella del APK de 1.5.0, `apksigner verify`, y qué ocurre al subir un AAB a una pista interna con "clave de firma propia" frente a "clave gestionada por Google" | Decide si se puede pasar de APK a Play sin perder datos | `apksigner`, Play Console (necesita tu acceso) |

**Resultado de S1 y S2 (2026-11-09, sin levantar Docker; se decidió con lo que ya se sabía y se comprobó lo demás en el emulador):**
- **S1:** el cliente oficial de Jellyfin para Android TV guarda varios usuarios con tokens distintos en el mismo dispositivo y el mismo `DeviceId`, así que se mantiene el `DeviceId` del SDK. La app ya no guarda un `DeviceId` fijo por cuenta; si en el servidor real el segundo inicio de sesión revocase el primer token, el síntoma sería que una cuenta pide "Volver a iniciar sesión" al volver a ella (la app lo gestiona), y la solución es un `DeviceId` por perfil. **Sin verificar contra un Jellyfin 12.2 con dos cuentas.**
- **S2:** no se pudo confirmar una página de Quick Connect de Jellyfin que acepte el código por URL; se eligió la opción A (página de Jellyflix Web). El estado de Quick Connect no permite al aprobador ver qué dispositivo pidió el código, así que la confirmación solo muestra el código.
- S3 y S4 siguen pendientes (fases 2 y 4).

Cada spike termina con una nota de una página en `docs/` y, si cambia el diseño, con una actualización de este plan.

---

## Fase 1 · Cuentas y QR (se entrega en la 1.6.0; la publicación en Play queda aparcada)

Objetivo: varias personas en el mismo televisor sin escribir contraseñas, con una forma cómoda de añadir cuentas y una versión instalable desde Google Play.

Orden: **1.1 → 1.2 → 1.3** para el código (1.1 y 1.2 comparten diseño de almacenamiento); **1.4 y 1.5** (publicación) van en paralelo porque no tocan las mismas piezas.

### 1.1 Almacén de perfiles en TV (M)

- **TV:** `ProfileStore` nuevo (sustituye el uso directo de `SessionStore.load/save`). Una lista de perfiles `{serverUrl, userId, userName, avatarTag, tokenSealed, pinHash?, pinSalt?, lastUsed}` más el id del activo. Cada token se sella con `KeystoreVault` como hoy. Migración única: la sesión actual se convierte en el primer perfil. Se mueven al espacio del perfil: `seriesTracks`, `lastChannel`, `startVisit`, `HomeCache` (un fichero por `userId`). Aspecto y ajustes siguen siendo del dispositivo en esta fase. `AppViewModel.signOut()` se parte en: `leaveAccount()` (reinicia estado, para, suelta websocket) y `forgetProfile(id)`.
- **Web:** nada. (Web conserva una sesión; la lista de perfiles en navegador no se pide.)
- **Jellyfin:** S1 decide si hay `DeviceId` por perfil. Al **quitar** un perfil: llamar a cierre de sesión en el servidor (`POST /Sessions/Logout`) si hay red, y borrar siempre lo local aunque falle.
- **Prueba:** tests JVM del almacén (migración, orden, tope de perfiles, borrado, token sellado, sin tokens en claro); un perfil con token revocado marca solo ese perfil como "necesita iniciar sesión".

### 1.2 Selector de perfiles y cambio de cuenta (L)

- **TV:** pantalla "¿Quién está viendo?" con avatares (`/Users/{id}/Images/Primary` con el token del propio perfil, iniciales si no hay imagen, caché Coil) y nombres, navegable con el mando; entrada en Ajustes → Cuenta ("Cambiar de perfil", "Añadir cuenta", "Quitar este perfil"). Se muestra al abrir si hay 2 o más perfiles (opción "Preguntar al abrir", activada por defecto con 2+). Cambiar de perfil: **para la reproducción de vídeo y música** (informa el fin a Jellyfin con la posición), cierra el websocket del mando, vacía home, bibliotecas, favoritos, historial, recomendaciones, Live TV y módulos (la misma limpieza que hoy hace `signOut`), activa el nuevo token y recarga. El 401 de un perfil lo marca "necesita iniciar sesión" y abre el selector; los demás siguen intactos.
- **PIN opcional por perfil (en esta entrega):** teclado numérico para mando (4-6 dígitos), guardado con sal y hash (portar `hashPin/verifyPin/waitAfterFailures` de `core/parental.ts`), espera creciente tras fallos. Se pide **cada vez que el perfil pasa a activo** (cambio o arranque en frío). "Olvidé el PIN" = quitar el perfil y volver a iniciar sesión (requiere contraseña o Quick Connect, así que sigue siendo seguro). El texto de la pantalla dice, como en el modo infantil de la web, que el PIN protege el uso desde este televisor y que los permisos de contenido son los de Jellyfin.
- **Watch Next (Google TV):** decisión propuesta: la fila del *launcher* se escribe **solo para el perfil activo y solo si no tiene PIN**; al cambiar se borra y se reescribe; hay un ajuste para apagarla del todo. Un `jellyflix://play/<id>` se abre en el perfil que esté activo tras desbloquear.
- **Web:** nada.
- **Jellyfin:** permisos, biblioteca, favoritos, historial y recomendaciones son por usuario y ya salen del servidor; nada que cambiar allí.
- **Prueba:** dos cuentas de prueba alternan sin contraseña; tras cambiar, el contenido, los permisos y las filas son los de la otra cuenta; la reproducción se detuvo y su posición quedó guardada en la cuenta anterior; revocar una sesión desde el panel de Jellyfin afecta solo a ese perfil; PIN: correcto, incorrecto con espera, reinicio de la app, intento de saltarlo con `jellyflix://`.
- **Riesgos:** foco del mando al volver al selector (hay antecedentes en las notas: `clearFocus()` antes de `requestFocusSoon()`); estado olvidado al cambiar (mitigación: un test que crea el estado, llama a `leaveAccount()` y comprueba que todo está en su valor inicial); `AppViewModel` ya es enorme: la limpieza vive en una clase de estado nueva, no en el ViewModel.

### 1.3 Añadir cuenta con credenciales o Quick Connect (S, dentro de 1.2)

- **TV:** "Añadir cuenta" reutiliza `SignInScreen` con el servidor ya fijado (el mismo servidor del perfil activo; otro servidor queda fuera de alcance) y, al terminar, no cierra la sesión actual: añade un perfil. La contraseña se usa una vez y no se guarda.
- **Web / Jellyfin:** sin cambios.

### 1.4 Vinculación por QR (M)

- **Diseño (lo decide S2):**
  - **A (preferida):** el QR contiene `<webAddress>/#/link?c=123456` y abre una pantalla de Jellyflix Web: si ya hay sesión, muestra "¿Autorizar el código 123 456 para iniciar sesión en tu televisor?" con botones Autorizar/Cancelar (confirmación explícita, texto de aviso "solo si ves este código ahora en tu TV") y usa `authorizeQuickConnect`; si no hay sesión, primero pide iniciar sesión. No lleva contraseñas, tokens ni nombre de usuario.
  - **B (si hay página de Quick Connect de Jellyfin que acepte el código por URL):** el QR apunta a ella. Sin dependencia de Jellyflix Web.
  - **Sin ninguna de las dos** (usuarios que solo tienen la app de TV y no configuraron `webAddress`): el QR se oculta y queda el código manual con las instrucciones de siempre. Se deja constancia en la pantalla ("Configura la dirección de Jellyflix Web para ver el QR").
- **TV:** QR (con `QrImage.kt`) al lado del código; cuenta atrás visible del vencimiento del código; botón "Código nuevo" (hoy la espera de 10 minutos acaba en error sin remedio); el código manual sigue ahí. El mismo flujo sirve para "Añadir cuenta" (1.3).
- **Web:** ruta `#/link` (perezosa, fuera del primer paquete: hay presupuesto de 250 kB, hoy 227 kB), textos en 5 idiomas, un test e2e con el mock, y reutiliza la UI de aprobación de Ajustes.
- **Jellyfin:** Quick Connect activado en el servidor (si está apagado, el mensaje actual ya lo explica); el vencimiento del código lo fija el servidor (S2).
- **Prueba:** escanear desde un teléfono con sesión → confirmar → la TV añade el perfil; sin sesión; código vencido → "Código nuevo"; el contenido del QR no incluye secretos (test que lo comprueba); código manual sigue funcionando.
- **Riesgo de seguridad:** alguien podría mostrar un QR para que otra persona autorice su dispositivo (phishing por QR). Mitigaciones: confirmación explícita con el código a la vista, el código dura minutos y no se reutiliza, y un aviso en la pantalla.

### 1.5 Preparación técnica para Google Play (L, sin necesitar Play Console) · APARCADA

- **TV:** ficha de AAB (`bundleRelease` en Gradle y en `release.yml`, con el APK como hasta ahora); comprobar 64 bits y 16 KB; revisar `targetSdk` frente al requisito vigente; revisar `WRITE_EPG_DATA` y `usesCleartextTraffic` y redactar su justificación; banner 320×180 por idioma (EN y ES) e icono; **dos sabores sin cambiar el `applicationId`** (`store` y `direct`) que solo se diferencian en una constante de compilación (ver 1.6).
- **Documentación** (`docs/PLAY-PUBLISHING.md`): requisitos de la ficha (nombre, descripción corta y larga, capturas de TV, gráfico de funciones, política de privacidad alojada en el sitio `jellyflix-site`, formulario de seguridad de datos, clasificación de contenido), **cuenta de revisión**: Play exige que el revisor pueda usar la app y la app necesita un servidor; hay que preparar un Jellyfin de demostración con una cuenta de solo lectura y contenido libre.
- **Nombre y marca:** ya existe un cliente llamado "Jellyflix" (Flutter, con presencia en tiendas) y el nombre "Jellyfin" tiene reglas de uso en descripciones. Hay que decidir el nombre de ficha antes de pedir nada a Play.
- **Web / Jellyfin:** nada.
- **Depende de P:** todo lo que no sea compilar y documentar.

### 1.6 Versión instalada y comprobación de actualizaciones (S) · APARCADA

- **TV (sabor `direct`):** Ajustes → Acerca de: versión y código instalados, canal ("Instalación directa" / "Google Play" por la constante y por `getInstallSourceInfo`), botón **"Buscar actualización"** que consulta *solo cuando se pulsa* `releases/latest` del repositorio (excluye borradores y prelanzamientos, así que es la versión "estable"), compara versiones y muestra las notas, la dirección de descarga y un QR; no descarga ni instala nada por su cuenta (no se pide `REQUEST_INSTALL_PACKAGES`). Coherente con la promesa de no hablar con terceros sin que lo pidas: se dice en la pantalla qué dirección se va a consultar.
- **TV (sabor `store`):** el botón desaparece y el texto dice "Las actualizaciones las gestiona Google Play" (la política de Play prohíbe que una app de la tienda se actualice por otro medio).
- **Web:** Ajustes → Acerca de ya muestra la versión; sin cambios (se actualiza con la imagen Docker).
- **Prueba:** tests JVM de la comparación (1.9.9 < 1.10.0, versiones con sufijo, respuesta rota, sin red), limitación de tasa de GitHub (60/h sin autenticar) y caché de 24 h; captura en el emulador de ambos sabores.

### 1.7 Pruebas de continuidad de datos entre canales (S, depende de P) · APARCADA

Matriz documentada en `PLAY-PUBLISHING.md`: APK→APK (misma clave), tienda→tienda, APK→tienda y tienda→APK. **El resultado depende de S5:**

- Si el AAB se sube con *tu* clave (Play App Signing con clave propia importada), la tienda firma con la misma clave que el APK y se puede pasar de un canal a otro **conservando datos** (el código de versión debe subir siempre).
- Si Google genera la clave de firma, la tienda y el APK tendrán firmas distintas y pasar de uno a otro exige **desinstalar** (se pierden la sesión, los perfiles y los ajustes). En ese caso, el plan lo documenta y la app necesita una copia previa de ajustes en el servidor (ya existe) para no empezar de cero.
- Decisión que es tuya: importar la clave actual a Google (irreversible) o aceptar canales separados.

### Qué se entrega en la fase 1

| | Web | TV | Depende de |
|---|---|---|---|
| 1.1-1.3 Perfiles | nada | almacén, selector, PIN, añadir cuenta, quitar perfil | J (S1) |
| 1.4 QR | pantalla `#/link` | QR + cuenta atrás + código nuevo | J (S2) |
| 1.5-1.7 Play | nada | AAB, sabores, Acerca de, documentación | **P** (cuenta de desarrollador, revisión, cuenta de demostración) |

**Criterio de cierre:** las pruebas de "Cómo comprobarlo" de las mejoras 1, 2 y 7 pasan en emulador (`Television_test`) con un Jellyfin 12.2 de prueba; la pasada en el televisor real queda anotada aparte.

### Estado de la fase 1 (2026-11-09)

Construido y comprobado:
- **1.1, 1.2, 1.3 (TV):** `data/Profiles.kt` (cuentas, PIN con PBKDF2 y espera creciente, formato de almacenamiento, migración de la sesión única), `SessionStore` por cuentas, `AppViewModel` con `Gate` (selector, PIN, inicio de sesión), `leave()` que para el vídeo y la música y vacía todo, `expireActive()` para el 401 de una sola cuenta, `removeProfile()` que avisa al servidor (`reportSessionEnded`) y borra lo local, pantallas `ProfileScreens.kt`, Ajustes → Cuenta, textos EN/ES. 30 pruebas JVM nuevas (`ProfilesTest`, `QuickLinkTest`); 215 en total, todas pasan; el build de release (R8) compila.
- **Comprobado en el emulador `Television_test` (nunca en el tuyo):** la sesión antigua de ese emulador se migró sola a una cuenta con sus datos; selector con 3 cuentas y su ayuda; cambiar de cuenta desde Ajustes; poner un PIN (dos veces), que se guarda como hash; PIN equivocado; un 401 de una cuenta la deja pidiendo volver a entrar sin tocar las demás (con un servidor falso que rechaza el token); quitar una cuenta llama al cierre de sesión del servidor; añadir una cuenta con un código Quick Connect (servidor falso con respuestas completas) y entrar con ella; el QR con el código, la cuenta atrás y "Código nuevo".
- **1.4:** `data/QuickLink.kt` (el enlace del QR: solo la dirección de la web y los seis dígitos), QR + cuenta atrás + "Código nuevo" en el inicio de sesión de la TV, ruta `#/link` en la web (`LinkPage`, `ApproveCode` extraído de Ajustes) con textos en los cinco idiomas, 4 tests de componente, 1 de ruta y 2 e2e. Web: 843 tests, lint, tipos y presupuesto de la primera pantalla (227,5 kB de 250) sin cambios.
- Cambio respecto al plan: con un PIN el cambio de cuenta lo pide **cada vez que la cuenta pasa a activa** (cambio o arranque), y la fila de Google TV solo se escribe para cuentas **sin PIN** (el interruptor para apagarla del todo quedó fuera).

**Sin comprobar** (necesita un Jellyfin real con dos cuentas y/o una TV): que el segundo inicio de sesión no revoque el primer token (S1), el cambio con vídeo y música sonando contra un servidor real, el escaneo del QR desde un teléfono real (solo se probó la página con el mock y el contenido del enlace con tests), el avatar real de un usuario (en el emulador se ven las iniciales), y la TV física.

---

## Fase 2 · Uso diario: ocultar y limitar el autoplay (se entrega en la 1.6.0)

Depende de la fase 1 solo en TV (el almacén de perfiles aporta el espacio por cuenta); en web puede avanzar a la vez.

### 2.1 Ocultar de "Continuar viendo" y series de "Siguiente" (M)

- **Núcleo (web `core/`, TV `data/`):** `HiddenStore` por cuenta con dos conjuntos: `resume` (id del título) y `nextUp` (id de la serie), con fecha de ocultado y un nombre para poder mostrarlo en la lista de restaurar sin ir al servidor. El filtro se aplica en el repositorio, no en la UI: `getContinueAll`, `getContinueEpisodes`, `getNextUp`, la fila de "Continuar" de las páginas de serie, y en TV también `WatchNext`. Como `getNextUp` y `getResumeItems` piden un `limit`, se pide un margen extra (limit + número de ocultos) para que las filas no queden cortas.
- **Reglas:**
  - "Ocultar de Continuar viendo" actúa sobre ese título (en un episodio, sobre ese episodio) y **no toca** posición, estado de visto ni favoritos.
  - "Ocultar serie de Siguiente" actúa sobre la serie entera.
  - Siguen visibles en biblioteca, búsqueda y la página del título. La posición sigue guardada (el botón de la página dice "Continuar desde…").
  - Un título oculto que se vuelve a reproducir **voluntariamente** (con Reproducir, no por una cola ni autoplay) sale de la lista de ocultos y vuelve a "Continuar viendo". Las series excluidas de "Siguiente" solo vuelven cuando se restauran expresamente (ver un episodio de esa serie no las restaura).
  - Cada cuenta tiene su lista; sobrevive al reinicio.
- **Web:** dos entradas en `CardMenu.tsx` (solo aparecen en las tarjetas de esas filas: hace falta pasar el contexto de fila a la tarjeta, hoy `cardActions.ts` no lo conoce), aviso con "Deshacer" (el `showToast` actual, ampliado con acción, ~6 s), y en Ajustes → Biblioteca una sección "Ocultos" con las dos listas y "Restaurar" (uno o todos). Textos en 5 idiomas.
- **TV:** dos opciones en el menú de pulsación larga, aviso con "Deshacer" (selección con el mando durante unos segundos), y Ajustes → Cuenta → "Elementos ocultos" con restaurar.
- **Jellyfin:** nada (decisión del lado del cliente, confirmada por S3). Consecuencia que se debe explicar en pantalla: otro cliente de Jellyfin (o la web oficial) seguirá mostrando el título, y web y TV de la misma cuenta **no comparten** la lista hasta la fase 3.
- **Prueba:** unit del filtro y de las reglas de vuelta; e2e web con el mock (ocultar, deshacer, reiniciar, restaurar, reproducir de nuevo); en TV, dos perfiles con listas distintas.
- **Riesgo:** un título borrado del servidor deja un id huérfano; se purga al restaurar o al pasar de 500 entradas.

### 2.2 Límite de "¿Sigues viendo?" y temporizador de vídeo (M)

- **Núcleo:** módulo puro `core/watchLimit.ts` (y su equivalente Kotlin) con el contador de episodios seguidos y la decisión "pedir confirmación" / "continuar" / "parar".
- **Reglas que se fijan antes de programar:**
  - Cuenta **episodios consecutivos reproducidos por autoplay** (cada salto automático suma 1; el primero, elegido por la persona, cuenta como el primero de la racha).
  - Se reinicia al: pulsar Reproducir en un título, confirmar "Sí, sigo aquí", salir del reproductor, cambiar de perfil o llevar más de 30 min sin reproducir. Una interacción real con los controles (pausar, buscar) **no** reinicia; sería demasiado fácil de falsear.
  - Valores: desactivado (por defecto, comportamiento actual), 2, 3, 4, 6, 8 episodios.
  - Al alcanzar el límite no empieza el siguiente: aparece el aviso "¿Sigues viendo?" con "Seguir" y "Parar"; si nadie responde en 60 s, para (y guarda la posición, que ya se guarda cada pocos segundos).
- **Temporizador de vídeo:** menú del reproductor: "Parar en 15/30/45/60/90/120 min" y "Al terminar este episodio". Parar = pausar, guardar posición y salir al título, con aviso de 30 s (oscurecer o bajar el volumen) para que no sea brusco.
- **Casos de coincidencia (con test para cada uno):**
  1. El temporizador vence a mitad de episodio → para ahí y guarda.
  2. Vence durante la cuenta atrás de "Siguiente" → gana el temporizador, no empieza el siguiente.
  3. "Al terminar este episodio" + autoplay → el episodio acaba y **no** se inicia el siguiente (ni se pide confirmación).
  4. Llega el límite de episodios y también hay temporizador → se muestra una sola pregunta; si se confirma, el temporizador sigue corriendo.
  5. Reproducción remota ("Reproducir en…") → se cuenta igual, pero el aviso aparece en el dispositivo que reproduce.
- **Web:** `Controls.tsx`/`SettingsMenu.tsx` (temporizador) y `PlayerStage.tsx` + `useUpNext` (la fase `waiting` ya existe: se reutiliza para "esperando confirmación"). Ajustes → Reproducción: "¿Sigues viendo? tras N episodios".
- **TV:** `MainActivity.kt:170` y el reproductor; el aviso es un diálogo accesible con el mando. El ajuste se guarda en `TvSettings` y se sincronizará en fase 3 (es una preferencia de reproducción, no de pantalla).
- **Jellyfin:** nada. Lo único del servidor es el informe de reproducción de detención (ya se envía).
- **Prueba:** tests puros del contador y de las coincidencias; e2e web con reloj simulado; con la función desactivada, los tests actuales de autoplay (`autoplay.spec.ts`, `series.spec.ts`) pasan sin cambios.

### Qué se entrega en la fase 2

| | Web | TV | Depende de |
|---|---|---|---|
| 2.1 Ocultar | menú, deshacer, sección "Ocultos" | menú largo, deshacer, "Elementos ocultos" | J (S3, solo confirmar) |
| 2.2 Autoplay | temporizador + límite en reproductor y Ajustes | diálogo + ajustes | nada |

**Criterio de cierre:** pruebas de las mejoras 4 y 5 con dos cuentas; sin regresión del autoplay actual.

### Estado de la fase 2 (2026-11-09)

Construido y comprobado:
- **2.1 Ocultar (web y TV).** Núcleo puro `core/hidden.ts` y `data/Hidden.kt` (mismas reglas; 17 + 10 pruebas): un título oculto de "Continuar viendo" vuelve solo cuando se reproduce de nuevo (se compara la fecha de última reproducción **del servidor** con la que tenía al ocultarlo, así no importa el reloj del dispositivo); una serie oculta de "Siguiente" no vuelve hasta restaurarla. Web: `platform/web/hidden.ts` (por cuenta, `owner.ts`), `components/hiddenActions.ts`, entradas en el menú "⋯" de las tarjetas de esas filas (Inicio y bibliotecas), aviso con "Deshacer" y tarjeta "Oculto…" en Ajustes → Apariencia. TV: `HiddenItems` por cuenta en `SessionStore`, filtro aplicado al leer las filas (y a la fila de Google TV), entradas en el menú largo, diálogo "Deshacer", y Ajustes → Cuenta → "Ver lo que está oculto". Pedir unos títulos de más al servidor para que la fila siga llena (`hiddenMargin`, web).
- **2.2 Límite y temporizador.** Reglas puras `core/watchLimit.ts` y `data/WatchLimit.kt` (12 + 7 pruebas, incluidos los cinco casos de coincidencia). Web: `useWatchGuard` en el reproductor, diálogo "¿Sigues viendo?", aviso del temporizador, página "Temporizador de sueño" en el menú del reproductor, ajuste en Reproducción. TV: `titleEnded` y `askStillWatching` en el `AppViewModel`, `SleepPanel` y botón en los controles del reproductor, ajuste en Ajustes → Reproducción. Un detalle de diseño: la cuenta de títulos solo se cree para el título que empezó solo; uno elegido a mano empieza una cuenta nueva (en la web esa comprobación es idempotente porque React puede ejecutar los efectos dos veces).
- **Pruebas:** web 4 e2e de ocultar (3) y de límite/temporizador (6) contra el servidor de pruebas; TV en el emulador `Television_test` con tu cuenta real: el menú largo de "Siguiente" ofrece ocultar la serie, el aviso con "Deshacer" aparece y deshacer devuelve la fila (solo cambia datos locales; no se reprodujo nada).
- **Sin comprobar:** el reproductor de la TV con el límite y el temporizador (hace falta reproducir un título real y sería escribir estado en tu servidor), y la web contra tu servidor real.

---

## Fase 3 · Sincronización opcional de preferencias (se entrega en la 1.6.0)

Se hace después de la 1 (necesita cuentas separadas en TV) y de la 2 (para decidir si las exclusiones se sincronizan).

### 3.1 Aspecto por cuenta en TV (M)

- **TV:** `Appearance` pasa a vivir en el espacio del perfil (con el valor actual del dispositivo como valor inicial). `TvSettings` queda en dos grupos: *del dispositivo* (margen de pantalla, tamaño de texto, límite de bitrate, modo de pantalla/frecuencia, `autoplay`…) y *de la cuenta* (idioma de subtítulos, saltos automáticos, "¿Sigues viendo?").
- **Web:** nada (ya guarda por navegador; el aspecto no depende de la cuenta hasta la sincronización).

### 3.2 Motor de sincronización (L)

- **Qué se sincroniza (lista blanca y por secciones):** tema (lienzo y acento), orden y visibilidad del menú, filas del inicio (orden/visibles), tamaño de póster, idioma de la interfaz si el cliente lo soporta, y las opciones de reproducción que no dependen del aparato (¿Sigues viendo?, autoplay, subtítulos preferidos). **Nunca** se sincronizan margen de TV, tamaño de texto, límite de bitrate, lo del reproductor ligado al hardware, ni nada con direcciones, tokens o PIN.
- **Formato:** `sections.<nombre> = {v, updatedAt, deviceId, data}` dentro del fichero de `displayPrefs` actual. Versionado por sección; un cliente que no conoce una sección la conserva intacta; si una sección tiene un `v` mayor que el que entiende, la **ignora y no la sobrescribe**.
- **Primera activación:** cuadro de elección "Usar los ajustes guardados en tu cuenta" / "Subir los de este dispositivo" / "Cancelar", con un resumen de lo que cambia (tema, filas…). Nada se escribe ni se aplica antes de elegir.
- **Ediciones simultáneas:** última escritura gana **por sección** (no por fichero), con marca de tiempo del cliente corregida con la hora del servidor (cabecera `Date` de la respuesta) y desempate por `deviceId`. Se escribe con leer-modificar-escribir y, si la sección guardada es más nueva que la leída, se vuelve a leer y a aplicar. Alternativa descartada: fusión campo a campo (complejidad sin valor claro para preferencias).
- **Cambios sin conexión:** los cambios locales se marcan como pendientes y se envían al reconectar; si en el servidor hay algo más nuevo que lo pendiente, gana lo del servidor para esa sección y se informa de ello con un aviso discreto.
- **Cuándo se sincroniza:** al abrir la app (leer), tras un cambio (escribir, con retardo de unos segundos) y desde un botón "Sincronizar ahora"; nunca en bucle. Un interruptor por cuenta y dispositivo (apagado por defecto).
- **Web:** `core/syncPrefs.ts` (puro, con tests de fusión y de conflicto) encima de `displayPrefs`/`settingsBackup`; Ajustes → Copia de ajustes se amplía con el interruptor y el estado ("Última sincronización…"). **TV:** `AppearanceBackup.kt` evoluciona al mismo formato por secciones; Ajustes → Aspecto → Sincronización.
- **Jellyfin:** preferencias de pantalla del usuario (J). Límite de 200 000 caracteres ya considerado. Las cuentas están aisladas por usuario (comprobable con dos perfiles).
- **Prueba:** cambiar el tema en web aparece en TV con la misma cuenta, sin tocar el margen de la TV; dos cuentas conservan lo suyo; edición simultánea (dos clientes de prueba); sin conexión; cliente antiguo (1.5.0) que guarda su aspecto no destruye las secciones nuevas; sección con `v` futura se respeta.
- **Riesgo:** pisar los ajustes de otra persona al activar. Mitigación: la elección inicial y que ninguna escritura ocurra mientras no esté activado.

### 3.3 (Después) Ocultos sincronizables (S)

Solo cuando 3.2 esté estable: la lista de ocultos (2.1) es un conjunto con altas **y bajas**, por lo que no vale "última escritura gana" sin más; se guardan las bajas con marca (lápidas) y se fusionan por unión menos lápidas más nuevas. Se deja definido pero no se construye hasta que lo pidas.

### Qué se entrega en la fase 3

| | Web | TV | Depende de |
|---|---|---|---|
| 3.1 | nada | aspecto y ajustes por cuenta | fase 1 |
| 3.2 | motor + interruptor + primera activación | formato por secciones + interruptor | J (preferencias de pantalla) |

### Estado de la fase 3 (2026-11-09)

Construido y comprobado:
- **3.1 Aspecto por cuenta en TV.** `SessionStore.appearance` guarda el aspecto bajo la cuenta activa (`look.<clave>.<id>`), con el aspecto anterior del dispositivo como valor de partida; se recarga al entrar en una cuenta y se borra al quitarla. Los ajustes de pantalla (margen, tamaño de texto, bitrate) siguen siendo del dispositivo; los ajustes de reproducción que se sincronizan se aplican al entrar, así que con la sincronización activa también siguen a la cuenta.
- **3.2 Motor de sincronización.** Formato `CustomPrefs["sync"]` = `{v, sections:{appearance|playback:{v, at, by, data}}}`, en un campo propio (no en el fichero manual, así un cliente 1.5.0 que guarda ese fichero no lo estropea). Reglas puras iguales en web y TV (`core/syncPrefs.ts`, `data/SyncPrefs.kt`): última escritura por sección según el reloj del servidor (cabecera `Date`), cambios sin conexión que conservan su hora, secciones de formato posterior o desconocidas intactas, elección en la primera activación sin tocar nada antes. Ids que solo tiene la otra app (menú `collections` de la TV, fila `music` de la web, `favorites`...) se conservan al enviar. Web: `platform/web/sync.ts` + `syncData.ts`, tarjeta en Ajustes → General, aviso al recibir. TV: `SyncEngine` (con funciones inyectadas, probado sin Android), interruptor y "Sincronizar ahora" en Ajustes → Apariencia.
- **Pruebas:** 18 + 12 (web, incluida una carga útil copiada tal cual de una ejecución real de la TV) + 2 e2e con dos navegadores; 17 en la TV. En el emulador `Television_test` probé la TV contra un servidor falso de preferencias (no tu servidor): activó la sincronización, subió `appearance` (Midnight, menú, filas) y `playback` con `by: "tv"`, y mostró "Última sincronización".
- **Sin comprobar:** la sincronización contra tu Jellyfin real (escribe un campo `sync` en las preferencias de tu usuario: pendiente de tu permiso), y la ida y vuelta web ↔ TV con tu servidor. Las ediciones simultáneas reales de dos dispositivos solo se probaron con el servidor de pruebas.
- **Pendiente a propósito:** sincronizar la lista de ocultos (3.3): hace falta guardar también las bajas.

### Auditoría de las fases 1-3 (2026-11-09)

Revisión completa de seguridad, rendimiento y fallos de lo construido en las fases 1, 2 y 3. Corregido:

| # | Dónde | Hallazgo | Arreglo |
|---|---|---|---|
| 1 | TV `AppViewModel` | **Mezcla entre cuentas.** Una petición lenta de la cuenta A podía terminar después de cambiar a B: escribía sus filas (o expiraba el token de B con un 401 tardío). | Todo el trabajo de la cuenta cuelga de un `accountJob` que se cancela al salir de la cuenta o al expirar su token (`launchSafe`); lo que no es de una cuenta (iniciar sesión, selector, quitar cuenta) usa `launchApp`; los informes de "dónde me quedé" usan `launchFor(sesión)`, terminan siempre y solo muestran un error si esa cuenta sigue en uso. |
| 2 | TV `SyncEngine` | Una cancelación (cuenta abandonada) se capturaba como "servidor no alcanzable" y escribía el estado de sincronización **en la cuenta siguiente**. | Se relanza `CancellationException`; las funciones de la TV comprueban `stillIn(sesión)`. Prueba nueva. |
| 3 | TV PIN | El hash PBKDF2 (lento a propósito) corría en el hilo de la pantalla: tirón del mando en TV lentas; dos pulsaciones rápidas podían contarse contra el mismo número de intentos. | `checkPin` es `suspend`, calcula en `Dispatchers.Default` y va bajo un `Mutex`; el teclado no envía otro PIN mientras se comprueba uno; `setPin` también calcula fuera del hilo principal. Comprobado en el emulador (poner PIN, pedirlo para quitarlo). |
| 4 | TV migración | La migración de la sesión antigua hacía dos escrituras separadas (borrar claves viejas, escribir cuentas): una parada entre ambas dejaba la TV sin sesión. | Una sola escritura. |
| 5 | TV quitar cuenta | Si el servidor no respondía, "Quitar cuenta" esperaba sin límite. | Tope de 6 s para pedir al servidor que cierre la sesión; la cuenta se borra igualmente. |
| 6 | Web sync | Una sincronización en vuelo podía aplicarse (o guardar su estado) en **otra cuenta** que iniciara sesión en el mismo navegador, o reactivarse sola si se apagaba mientras corría. | `run` comprueba el propietario de almacenamiento y que siga activada tras cada espera; el último informe se asocia a su cuenta; una ejecución de otra cuenta espera a que termine la anterior. 2 pruebas nuevas. |
| 7 | Web "¿Sigues viendo?" | Los temporizadores (el minuto de la pregunta, el temporizador de sueño) dependían de callbacks que cambian de identidad en cada render: podían reiniciarse. | Usan una referencia a la última función; el efecto solo depende de lo que cambia de verdad. |

Revisado y sin cambios (con el motivo):
- **PIN:** guardado como PBKDF2-SHA256 con sal aleatoria de 16 bytes y comparación en tiempo constante; 5 intentos libres y luego 30 s duplicando hasta 15 min, persistente entre reinicios. Es un cierre de uso de la TV: con 4-6 dígitos cualquier hash se puede probar entero si alguien tiene acceso al fichero de la app (y entonces tampoco puede sacar el token, que está sellado en el Keystore). La copia de seguridad de Android está desactivada (`allowBackup=false`). El intento fallido se cuenta con el reloj de pared: cambiar la hora del sistema acorta una espera (se anota, no se corrige).
- **Quitar una cuenta con PIN** desde el selector no pide el PIN: quitar solo reduce acceso (hay que volver a iniciar sesión con contraseña) y no concede nada. Si prefieres pedirlo, es un cambio pequeño.
- **Enlace del QR:** solo lleva la dirección web y 6 dígitos (validados con expresión regular en TV y web); la página `#/link` exige un clic explícito con el código a la vista y avisa de que quien entra puede ver como tú. Riesgo residual conocido de cualquier "código de dispositivo": alguien podría enviar un enlace con *su* código a otra persona; por eso el aviso.
- **Ocultos y sincronización:** datos de la red/almacenamiento saneados al leer (claves `__proto__`, tamaños, tipos, formatos posteriores), límites (500 ocultos, 50 000 caracteres de sync), nada se ejecuta ni se inserta como HTML; la sincronización conserva el resto de las preferencias de pantalla del usuario y las ids que solo conoce la otra app.
- **Registros:** el código nuevo no escribe tokens, códigos ni PIN en el registro. **Rendimiento:** primera pantalla web 232,3 kB de 250; las filas piden unos pocos elementos más (hasta 40) solo si hay ocultos; `LinkPage` y la tarjeta de sincronización no cargan hasta que se usan.
- **Riesgo aceptado:** dos dispositivos que guardan la sincronización en el mismo instante (ventana de unos cientos de milisegundos entre leer y escribir) podrían pisarse una sección; se arreglaría con la siguiente sincronización solo si el otro dispositivo vuelve a cambiarla. Jellyfin no ofrece escritura condicional sobre las preferencias de pantalla.

---

## Fase 4 · Seerr (decisión 2026-11-10: va en un módulo, con su propia versión; la 1.6.0 son las fases 1-3)

> **Decisión (2026-11-10).** Seerr no va en la aplicación principal sino como **módulo del contenedor `modules/`**, igual que Retro TV y Match: quien no instala el contenedor (o ese módulo) no tiene nada de Seerr, ni código ni botones, y el módulo se publica con su propio ciclo. La app web ya sabe mostrar un botón "Módulos" solo cuando un contenedor responde; el módulo añade ahí su página (buscar, estado, solicitar). Esto resuelve además la pregunta de 4.1: el contenedor es el intermediario (guarda la dirección de Seerr y habla en nombre del usuario). La 1.6.0 de la app queda con las fases 1-3; el módulo sale después, como versión del contenedor.

### 4.1 Conexión (M)

- **Decisión (la fija S4):**
  - **Directa desde el navegador** solo si Seerr devuelve CORS para el origen de Jellyflix y la autenticación por sesión del propio usuario funciona sin exponer credenciales privilegiadas. Cada persona inicia sesión en Seerr con su cuenta (Seerr admite inicio con Jellyfin), de modo que se aplican **sus** permisos y cuotas.
  - **Con intermediario** (lo más probable): una ruta nueva en `modules/` (el contenedor que ya valida el token de Jellyfin del llamante). Guarda la dirección de Seerr y habla con Seerr **en nombre del usuario** (sesión de cada usuario, no la API key de administrador). Si hubiera que usar una API key, vive solo en el contenedor, nunca en el cliente, y se limita a lo mínimo.
  - Un usuario que no tiene cuenta Seerr no ve nada: la integración está oculta.
- **Web:** Ajustes → Integraciones → Seerr (dirección, "Probar conexión", estado), explícita y apagada por defecto, con la advertencia de que se contactará un servidor distinto al de Jellyfin. **TV:** nada en esta fase.
- **S:** versión mínima de Seerr compatible, escrita en la pantalla.

### 4.2 Buscar, estados y solicitar (L)

- **Web:** la búsqueda (`SearchPage`) muestra, junto a los resultados de la biblioteca, resultados de Seerr de películas y series con su estado: *disponible*, *parcialmente disponible*, *solicitada*, *en proceso*, *rechazada* (los estados que expone Seerr). Botón "Solicitar" en películas; en series, selector de temporadas (todas o concretas). Si el título ya está en la biblioteca y se puede identificar **con certeza** (mismo id de TMDb en `ProviderIds` de Jellyfin; nunca por nombre), "Abrir en Jellyflix". Mensajes específicos para: solicitud duplicada, permisos insuficientes, cuota agotada (con cuándo se renueva), instancia inaccesible o rechazada.
- **Jellyfin:** solo se usa para el emparejamiento por TMDb id (una consulta por lote, con el filtro de ids de proveedor).
- **S:** estados, cuotas, errores y permisos según S4.
- **Prueba:** mock de Seerr (servidor de pruebas en `web/test/mock`) con los estados y errores; e2e para solicitar una temporada y ver el estado; test de seguridad (`security.test.ts` ya existe) que verifica que no hay claves de Seerr en el código del cliente ni en el almacenamiento; prueba manual con un Seerr real.

### 4.3 (Después) Mando de TV (M, solo si 4.2 es estable)

Buscar y solicitar con el mando es más difícil (teclado en pantalla, selección de temporadas). Se evalúa tras un periodo de uso real de la web. Si se hace, consume el mismo intermediario.

### Qué se entrega en la fase 4

| | Web | TV | Depende de |
|---|---|---|---|
| 4.1 | ajustes + conexión | nada | S (S4), `modules/` si hay intermediario |
| 4.2 | búsqueda, estados, solicitudes | nada | S |
| 4.3 | — | evaluación posterior | S |

---

## 4. Resumen por plataforma y dependencia

| Entrega | Web | TV | Jellyfin | Seerr | Google Play |
|---|---|---|---|---|---|
| 1.1-1.3 Perfiles y PIN | — | sí | cierre de sesión, `DeviceId` (S1) | — | — |
| 1.4 QR | `#/link` | QR y código nuevo | Quick Connect (S2) | — | — |
| 1.5-1.7 Play | — | AAB, sabores, Acerca de | — | — | **Cuenta, revisión, firma (S5)** |
| 2.1 Ocultar | sí | sí | nada (S3) | — | — |
| 2.2 Autoplay | sí | sí | informe de detención | — | — |
| 3.1-3.2 Sincronizar | sí | sí | preferencias de pantalla | — | — |
| 4.1-4.2 Seerr | sí | no | ids de TMDb | **sí** | — |

## 5. Preguntas abiertas para ti

Contestadas al empezar: Play queda aparcado (no se publica nada por ahora).

1. **PIN:** se hizo de 4 a 6 dígitos y se pide cada vez que la cuenta pasa a activa. ¿Lo dejamos así o prefieres otro criterio (por ejemplo, solo en el arranque en frío)?
2. **Watch Next con perfiles:** se hizo que la fila del launcher solo se escriba para la cuenta activa **sin PIN**. ¿Quieres además un interruptor para apagarla del todo?
3. **Servidores de prueba:** para S3 y S4 (y para comprobar S1 de verdad) conviene un Jellyfin 12.2 y un Seerr en Docker locales con cuentas de prueba, no tu servidor. ¿Puedo levantarlos cuando lleguemos a ello?
4. **Cuando se retome Play:** firma (importar `jellyflix.jks` o no), nombre de ficha, cuenta de revisión y verificación de desarrolladores de Android (ver 1.5-1.7).

## 6. Calendario orientativo (una persona, tamaños relativos)

Spikes S1-S5: ~2-3 días. Fase 1: 1.1-1.4 unas 2 semanas; 1.5-1.7 una semana de trabajo más los plazos de Play (revisión y, si la cuenta es personal reciente, un periodo mínimo de prueba cerrada que hay que verificar en Play Console). Fase 2: ~1,5 semanas. Fase 3: ~2 semanas. Fase 4: ~2 semanas la web.

## 7. Qué no se hace en este plan

Varios servidores, perfiles en la web, PIN que proteja el servidor, descarga o instalación automática de APK, ocultación en el servidor, sincronización de `HiddenStore` (queda definida pero no construida), Seerr en TV hasta que la web sea estable.
