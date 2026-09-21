# Pokéfolio como aplicación instalable

Entrega preparada sobre `main` **8bd16381ad07e753aa8e7b21d6301493f08a03fb**. Conserva las mejoras de Deseos, precios, preferencias, alertas y fondo de esa versión.

## Publicar

1. Abre el repositorio **adrigomez14/Pokemon-collection** en GitHub, rama `main`.
2. Sube **el contenido** de la carpeta de entrega **pokemon-collection-pwa** a la raíz del repositorio, manteniendo las carpetas `src`, `public`, `scripts` y `tests`. No subas la carpeta contenedora como subcarpeta.
3. Confirma los cambios desde GitHub y espera a que Vercel termine con estado **Ready**.
4. Abre **https://www.pokefoliotcg.es/catalogo**, espera a que cargue y busca **Instalar app** al final de la página.

No se ha publicado nada automáticamente. **No necesita SQL, migraciones, variables de entorno nuevas ni cambios en Supabase, DNS o SMTP.** No subas `.env`, secretos, `node_modules` ni `dist`. Las dependencias no cambian; no hace falta sustituir el lockfile.

Esta entrega sustituye archivos completos. Si modificas GitHub después de la versión indicada, integra primero tus cambios para no sobrescribirlos. No mezcles archivos de entregas anteriores.

## Instalar en el móvil

### Android

Abre la web en **Chrome**, pulsa **Instalar app** en el pie y, si aparece, **Instalar Pokéfolio**. También puedes usar el menú **⋮ → Instalar aplicación** o **Añadir a pantalla de inicio**, según el navegador. La última confirmación pertenece al navegador.

### iPhone o iPad

Abre la web en **Safari → Compartir → Añadir a pantalla de inicio → Añadir**. En algunas versiones, Compartir está dentro del menú. Si aparece «Abrir como app», déjalo activado. No instales desde el navegador interno de Instagram, Gmail u otra aplicación: abre primero Safari.

### Ordenador

En Chrome o Edge, utiliza **Instalar app** en el pie o el icono de instalación de la barra de direcciones. Si el navegador no ofrece instalación, la web continúa funcionando normalmente.

La instalación depende del navegador y del sistema operativo. Puede no aparecer si ya está instalada, el dispositivo está administrado o el navegador no la admite. Un marcador no siempre equivale a una instalación en modo app. En el móvil debería aparecer el icono de Pokéfolio y abrirse como una ventana independiente.

## Cuenta y datos

- Es la misma web, con la misma cuenta y los mismos datos en la nube. Puede ser necesario iniciar sesión de nuevo en la app instalada, según el navegador y el sistema.
- No es una publicación en Google Play ni App Store. No se añaden compras ni notificaciones push. Los avisos dentro de la web y los correos existentes conservan su funcionamiento.
- Requiere conexión para consultar y modificar la colección. No se guardan operaciones offline para ejecutarlas después.
- Si pierdes conexión con la app abierta, se ocultan sus controles y datos; los borradores permanecen **solo en memoria mientras esa pestaña siga abierta**. No cierres ni recargues una pestaña con cambios sin guardar.
- Una petición iniciada antes de perder la red puede haber llegado al servidor. Comprueba el resultado al reconectar antes de repetirla: el modo offline no deshace peticiones ya enviadas.
- Si abres una ruta normal de la app sin conexión, se muestra únicamente una pantalla pública de aviso, siempre que el navegador haya conservado la caché inicial. Al reconectar, **Comprobar conexión** lleva al catálogo. Las rutas de autenticación con parámetros y las APIs no se sustituyen por esa pantalla.

## Caché y actualizaciones

La nueva caché del service worker contiene exactamente seis recursos públicos: la pantalla sin conexión, sus estilos, su script y tres iconos. **No guarda HTML de la aplicación, bundles, colecciones, listas, mensajes, precios, tokens ni respuestas de Supabase/TCGdex.** Esto no elimina ni cambia el almacenamiento de sesión y preferencias que ya utilizaba la web.

El manifiesto se consulta por red, sin caché, para comprobar la reconexión. Que la web responda no garantiza que Supabase o TCGdex estén disponibles; sus errores siguen mostrándose normalmente.

Al detectar una actualización aparece un aviso al final de la página. **Actualizar** pide confirmación porque recargará esa pestaña y puede perder borradores sin guardar. **Ahora no** permite continuar. Las demás pestañas no se recargan automáticamente. La primera instalación tampoco fuerza una recarga. Si se cierran todas las pestañas, el navegador puede activar la versión en espera al volver a abrir, siguiendo el ciclo normal del service worker.

Borrar los datos del sitio elimina la caché técnica y puede cerrar la sesión, pero no elimina la cuenta ni la colección en la nube. Desinstalar el icono no siempre borra los datos del navegador. El navegador puede liberar cachés por falta de espacio o restricciones de privacidad.

## Comprobación después del despliegue

1. Entra por **www.pokefoliotcg.es**, instala y comprueba nombre, icono y apertura independiente.
2. Inicia sesión si es necesario; comprueba tu colección y Deseos. No hace falta crear ni eliminar datos para esta comprobación.
3. Con la app cargada, activa modo avión: debe mostrarse **Sin conexión**, sin controles privados utilizables. Reactiva la red y comprueba que puedes continuar.
4. Cierra una pestaña sin borradores, vuelve a abrir la app sin red y comprueba la pantalla pública. Si nunca llegó a completar la primera carga o se borró la caché, el navegador puede mostrar su propio error de red.
5. Comprueba en Safari de iPhone y Chrome de Android los márgenes, el menú de instalación y el icono. La simulación de escritorio no certifica una instalación física ni el notch de todos los dispositivos.

## Archivos y pruebas

Validación local completada: **803 pruebas unitarias/SQL, 156 E2E de regresión y 54 E2E de PWA aprobadas**; TypeScript frontend/API y lint sin errores. La regresión se ejecutó por proyectos (70 catálogo, 43 cuenta escritorio y 43 cuenta móvil). Los 54 escenarios PWA utilizaron un worker real y un build de producción, con datos sintéticos.

La entrega incluye manifiesto, iconos PNG y SVG fuente, worker, pantalla offline, controles React, estilos, integración, cabeceras y versionado de build; además de pruebas unitarias y E2E dedicadas. `scripts/pwa-test-server.mjs` es un servidor **solo de pruebas locales**: no se incluye en el build de Vercel ni expone endpoints de producción.

Comandos del proyecto: `npm test`, `npm run lint`, `npm run test:e2e` y el nuevo `npm run test:pwa`. Este último compila en modo producción con datos sintéticos, sin leer `.env`, y comprueba un service worker real en localhost. En este equipo las pruebas usan Edge mediante `PLAYWRIGHT_CHANNEL=msedge`.

Los iconos ya están generados; no necesitas ejecutar el generador para publicar. El SVG fuente y `scripts/generate-pwa-icons.mjs` permiten regenerarlos con Playwright si se cambia la marca.

La instalación física en iOS/Android y el comportamiento del despliegue final deben comprobarse después de publicar. No se han realizado cambios en producción, SQL real ni envíos de correo durante esta implementación.
