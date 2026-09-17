# Pokéfolio · Tu colección Pokémon TCG

Aplicación web personal en español, adaptable a móvil y ordenador. React + TypeScript + Vite en el navegador; Supabase para autenticación y PostgreSQL; TCGdex para catálogo, imágenes y referencias de Cardmarket.

## Qué puedes hacer

- Buscar cartas por nombre (parcial o exacto), categoría, expansión, rareza, tipo/elemento y número, con paginación.
- Mostrar sólo cartas con imagen, ordenar por nombre/número y alternar entre lista y cuadrícula.
- Descubrir expansiones nuevas desde TCGdex automáticamente, sin mantener una lista fija ni redesplegar por cada lanzamiento.
- Consultar catálogos en español, inglés y japonés. El nombre se busca en el idioma seleccionado: por ejemplo, **ピカチュウ** en japonés.
- Ver la imagen de cada carta cuando el proveedor la tenga disponible.
- Crear una cuenta, confirmar el correo, iniciar/cerrar sesión y recuperar la contraseña.
- Guardar cantidades, idioma, variante, conservación, notas y valoración manual opcional.
- Editar registros o eliminarlos con confirmación. Añadir otra copia del mismo registro suma su cantidad de forma atómica, conservando las notas y el valor manual anteriores.
- Consultar referencias y mínimos generales de Cardmarket, con fecha de origen y precios pulsables. Los mínimos NO están filtrados por idioma.
- Guardar opcionalmente la URL exacta del producto en cada registro; al abrirla se solicita el idioma de la carta (español por defecto en el catálogo). Sin URL guardada, se abre una búsqueda, no un producto garantizado.
- Filtrar y ordenar tu colección; ver cantidades, valoración orientativa y ejemplares sin precio.
- Exportar e importar copias JSON. Las colecciones grandes se dividen en partes descargables y restaurables.
- Descargar tu colección como Excel real con nombre, colección y precio, además de cantidad, total, idioma y variante.
- Usar un diseño de entrenador con panel tipo Pokédex, detalles de Poké Ball y colores de tipos; adaptable a móvil y respetuoso con la preferencia de movimiento reducido.

**Estado inicial:** el catálogo puede usarse sin configurar nada. El guardado y las cuentas requieren conectar TU proyecto de Supabase. No hay usuarios ni datos de colección ficticios en producción. La aplicación no está publicada en Internet automáticamente.

## 1. Abrir en este ordenador

Abre esta carpeta como proyecto en VS Code, no dentro de otro repositorio.

- Windows: abre **Abrir Pokefolio.cmd**. Mantén la ventana abierta y visita **http://localhost:5173**. Ctrl+C detiene la aplicación.
- Alternativa en PowerShell: ejecuta `./Start.ps1` desde esta carpeta. El script busca Node instalado o la copia portátil preparada en `%LOCALAPPDATA%/pokemon-collection-tools`.
- Si la política corporativa bloquea scripts, no la desactives: utiliza Node.js 24 LTS autorizado y las instrucciones npm de abajo, o consulta con tu administrador.

En cualquier equipo con Node.js 24 LTS:

```sh
npm ci
npm run dev
```

Node portátil se descargó de nodejs.org y su archivo se comprobó contra el SHA256 oficial. No se modificó el PATH global. El proyecto está separado de los proyectos que ya había en la carpeta de destino.

## 2. Activar cuentas y guardado privado

1. Crea un proyecto en [Supabase](https://supabase.com/dashboard). Elige una región cercana. La contraseña de PostgreSQL se introduce únicamente allí; la aplicación no la necesita.
2. Abre **SQL Editor → New query**. En un proyecto nuevo ejecuta, una vez y en este orden, [supabase/migrations/001_collection.sql](supabase/migrations/001_collection.sql), [supabase/migrations/002_cardmarket_links.sql](supabase/migrations/002_cardmarket_links.sql) y [supabase/migrations/003_feedback.sql](supabase/migrations/003_feedback.sql). Si ya tienes tu colección funcionando con migraciones anteriores, ejecuta **solo las que te falten**; no vuelvas a crear las tablas ya existentes.
3. En el diálogo **Connect** del proyecto o en **Project Settings → API / API Keys**, copia la **Project URL** y la clave **publishable**. En proyectos antiguos sirve la clave pública **anon**.
4. Abre [.env.local](.env.local), que ya existe con valores vacíos, y completa:

   ```dotenv
   VITE_SUPABASE_URL=https://TU_PROYECTO.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=TU_CLAVE_PUBLICA
   ```

   **Nunca uses `service_role`, `sb_secret_...`, la contraseña de la base de datos o una clave privada.** Las variables `VITE_*` son públicas: se incluyen en el navegador. El acceso a cada colección está protegido por RLS en PostgreSQL, no por ocultar la clave pública.

5. En **Authentication → Providers / Sign In**, activa Email y la confirmación de correo. Se recomienda exigir al menos 12 caracteres de contraseña también en Supabase, no solo en el formulario.
6. En **Authentication → URL Configuration**, establece `http://localhost:5173` como Site URL durante desarrollo y añade `http://localhost:5173/` a las Redirect URLs. Usa siempre el mismo hostname y puerto.
7. Reinicia la aplicación después de modificar las variables de entorno.
8. Pulsa **Mi cuenta → Crear una cuenta**, confirma el correo e inicia sesión. Ahora puedes guardar cartas.

El proveedor predeterminado de correo de Supabase tiene restricciones y límites de envío, y puede permitir solo direcciones autorizadas del equipo. Para usuarios reales configura un proveedor SMTP propio en Supabase y verifica remitente/dominio. Si no recibes mensajes, consulta sus registros de autenticación, correo no deseado y límites antes de repetir intentos.

La configuración admite proyectos alojados en `https://<id>.supabase.co`. Para Supabase autohospedado o un dominio personalizado hay que adaptar la validación de URL y la política CSP.

## 3. Usarla desde móvil y ordenador

Para acceso permanente desde ambos dispositivos, publica el frontend con HTTPS; ejecutar el servidor local no publica la aplicación.

Ejemplo con [Vercel](https://vercel.com/):

1. Sube **solo este proyecto** a un repositorio propio, excluyendo `.env.local`, `node_modules`, `dist` y tus copias JSON personales.
2. Importa ese repositorio en Vercel como proyecto Vite. Compilación: `npm run build`. Carpeta de salida: `dist`.
3. Añade las dos variables **públicas** de Supabase en la configuración del despliegue y publica. No subas ninguna clave secreta.
4. En Supabase cambia Site URL a tu dominio HTTPS y añade la URL exacta con barra final a Redirect URLs. Conserva localhost solo si vas a seguir desarrollando.
5. Configura SMTP para que registro y recuperación funcionen con tus correos reales.
6. Abre la misma URL en móvil y ordenador e inicia sesión con la misma cuenta.

[vercel.json](vercel.json) incluye cabeceras de seguridad y una política CSP que permite únicamente los servicios utilizados. No es necesario abrir puertos en el router. Revisa las cuotas y condiciones vigentes de cada proveedor: los planes gratuitos no garantizan disponibilidad permanente.

La colección se consulta de nuevo al volver a la ventana, al recargar y tras guardar. No hay edición colaborativa en tiempo real ni modo sin conexión. No edites simultáneamente la cantidad total de un mismo registro en dos dispositivos; las adiciones de copias sí usan suma atómica.

## Catálogo y nuevas expansiones

El catálogo se consulta directamente en la API pública de TCGdex, no se almacena como una lista fija en Supabase ni se incluye entero en la compilación. Por eso, las nuevas expansiones y cartas aparecen **cuando el proveedor las publica para el idioma elegido**, sin modificar el código ni desplegar de nuevo.

- El selector obtiene `/v2/{idioma}/sets` en ejecución. Se comprueba cada 15 minutos mientras el catálogo está abierto y visible, y al volver a la ventana si los datos llevan al menos 5 minutos en caché.
- La página de cartas visible se vuelve a consultar cada 5 minutos. **Actualizar catálogo** permite solicitar inmediatamente el índice y los resultados actuales. Los intervalos pueden retrasarse si el navegador suspende la pestaña.
- Elegir una expansión elimina los filtros de nombre/número y vuelve a la primera página.
- Los filtros activos siguen limitando los resultados. Esta actualización **no añade cartas a tu colección personal**, solo permite encontrarlas.
- No se garantiza cobertura completa, imágenes, precios ni disponibilidad el día del lanzamiento. Puede haber cartas sin traducir o aún no cargadas. El índice del proveedor también puede incluir series digitales de Pokémon TCG Pocket; no todos sus resultados corresponden a cartas físicas vendidas en Cardmarket.
- Si falla el índice, se conserva la lista anterior cuando exista y sigue siendo posible buscar por nombre o ID.

Comprobación del 16/09/2026: la API devolvió 154 expansiones en español, 218 en inglés y 184 en japonés. No se encontró `30th Celebration` / `30C` en esos índices. Las entradas `cel25` y `cel25cc` corresponden a Celebraciones del **25 aniversario**, no del 30. Estos números son una observación puntual, no una lista incorporada a la aplicación ni una confirmación de la fecha de lanzamiento. Consulta [la cobertura y limitaciones de TCGdex](https://tcgdex.dev/faq).

## Filtros del catálogo

- Al abrir la web o cambiar de idioma, **Nombre** está vacío y se selecciona **Novedades · expansión más reciente**. Se consulta el índice ordenado por `releaseDate` descendente, sin mantener un ID fijo; se muestra la primera expansión con cartas y se pagina dentro de ella por número. No es una ordenación global de todas las cartas ni una selección por popularidad.
- Selecciona **Todas las expansiones** o **Limpiar filtros** para salir de novedades y buscar en todo el catálogo. Las novedades reflejan la cobertura y las fechas del proveedor, que también puede incluir lanzamientos anunciados o series digitales.
- Categoría distingue Pokémon, Entrenador y Energía; no son filtros de sobres o cajas. Las opciones de categoría, rareza y tipo se consultan al proveedor en el idioma elegido.
- Nombre exacto distingue mayúsculas/minúsculas según TCGdex. Sin marcarlo se usa búsqueda parcial. Los filtros se combinan; si no hay coincidencias, prueba **Limpiar filtros**.
- El campo **Número** está en la fila principal, junto a Nombre. Es el código antes de la barra y conserva los ceros iniciales: `025` no es `25`. No admite barras ni comodines. Se busca el sufijo exacto del identificador porque el filtro estricto `localId` del proveedor no devuelve algunas cartas válidas.
- Más opciones de filtro contiene rareza y tipo. Ya no incluye un campo manual de ID de expansión: para filtrar por expansión concreta usa el selector **Expansión** de la fila principal.
- Cambiar la expansión limpia nombre/número, pero conserva los demás filtros. Cambiar el idioma reinicia los filtros, para no arrastrar términos de otro catálogo.
- Ordenar por nombre o número se aplica en el servidor antes de paginar, no sólo a las cartas visibles. Cambiar la ordenación aplica también los filtros preparados y vuelve a la primera página.
- **Sólo con imagen** indica imagen catalogada, no existencias en Cardmarket. No se incluyen «Sólo disponibles» ni «Más popular»: la fuente actual no proporciona esos datos.
- Se muestra el número de cartas de la página, no un total global estimado. Lista/cuadrícula cambia la presentación sin cambiar la búsqueda. Abre una carta para consultar su precio.

## Cómo interpretar los precios

La aplicación **no hace scraping de Cardmarket** ni requiere acceso a su API comercial. Consulta [TCGdex](https://tcgdex.dev/markets-prices), que incluye precios de mercado en las fichas.

- Solo se usan datos cuyo `unit` es `EUR`.
- Las referencias cero del feed se consideran no disponibles por precaución: no demuestran que una carta valga cero. Un valor manual de cero sí se respeta.
- Normal utiliza `pricing.cardmarket.trend`; Holo utiliza el campo `trend-holo`, según la nomenclatura del proveedor.
- Excepción conservadora para productos exclusivamente holo: si los indicadores descartan normal/reverse/primera edición y hay exactamente una variante detallada holo estándar sin subtipo ni estampados, con identificadores Cardmarket coincidentes, se utilizan sus precios de producto. Si los campos holo están vacíos/cero, se permite usar su `trend`/`low` general positivo. La ficha avisa de este origen. Corrige casos como Blastoise ex 200 de 151, pero no traslada precios entre variantes ambiguas.
- El dato adicional **Mínimo general del proveedor** usa `low` para normal y `low-holo` para holo, cuando es positivo y está disponible. No sustituye el valor de referencia ni el total de colección. No se muestra como oferta mínima española, inglesa o japonesa.
- Reverse y primera edición no heredan precios de otra variante: usa la valoración manual tras verificar el producto en Cardmarket.
- No se sustituyen precios españoles o japoneses por los de la ficha inglesa. Si faltan, se muestra **Sin precio**.
- Los datos de mercado no están ajustados al idioma, conservación, graduación o ejemplar concreto. No son una oferta de compra, una tasación ni una promesa de venta.
- La fecha mostrada es la del proveedor. **Actualizar precios** vuelve a consultar los últimos datos disponibles; no crea un precio nuevo ni altera valores manuales. Si falla una consulta, se conserva la referencia anterior y se avisa.
- Las fichas guardadas con versiones anteriores pueden no contener los detalles de variante necesarios. Tras actualizar la web, pulsa **Mi colección → Actualizar precios** para recuperarlos. No hacen falta nuevas tablas ni migraciones para esta corrección.
- Al pulsar un precio se abre una pestaña nueva. Si guardaste un **Enlace del producto en Cardmarket** en el formulario, se utiliza esa URL. Sin enlace guardado se abre una **búsqueda por nombre y número**, no una correspondencia garantizada. No se inventan slugs a partir del nombre ni se deduce un producto exacto solo a partir de un identificador de precio.
- Los enlaces solicitan `language=4` (español), `1` (inglés) o `7` (japonés), según el idioma del registro; `/es/` es únicamente el idioma de la interfaz de Cardmarket. Se descartan otros parámetros pegados para evitar filtros heredados de vendedor/estado. Verifica expansión, número, variante e idioma después de abrir la página: no se automatizan los filtros de variante ni conservación, y la búsqueda puede no conservar el idioma al entrar en un resultado.
- Solo se aceptan enlaces HTTPS a productos Pokémon de `www.cardmarket.com`. La app no descarga ni analiza esas páginas. Guardar una URL no verifica automáticamente que corresponda a la carta: debes comprobarla antes de guardarla.
- El enlace se conserva al actualizar referencias y sumar ejemplares sin aportar un enlace nuevo. Se puede cambiar o borrar desde la edición. Se incluye en las copias JSON; las copias antiguas sin ese campo siguen funcionando (al importar reemplazan el enlace por vacío).
- La valoración total es la suma de cantidad × (valor manual si existe, o referencia disponible). Los ejemplares sin precio se contabilizan aparte y no se tasan como si valieran cero. No se incluyen portes.

TCGdex puede carecer de imágenes de ciertas cartas o idiomas. En ese caso se muestra un marcador explícito, sin presentar una imagen de otro idioma como si fuera la correcta. Se usan recursos alojados por el proveedor; no se distribuye una copia completa del catálogo.

**Pendiente: oferta más barata por idioma.** TCGdex no proporciona un listado de ofertas con idioma, conservación, disponibilidad y precio. Un `low` general no resuelve ese requisito. Para mostrar automáticamente ese mínimo hace falta una fuente autorizada de ofertas y un backend que la consulte y almacene en caché. No se ha conectado ninguna fuente de ese tipo, ni se eluden los bloqueos de Cardmarket. Por ahora puedes consultar la página filtrada y guardar el importe comprobado como valor manual.

## Actualizar una instalación ya publicada

1. Exporta tu colección como copia de seguridad.
2. Si ya ejecutaste la migración de enlaces, **no ejecutes SQL de nuevo**: esta actualización de filtros y precios no cambia la base de datos. Sólo si todavía no aplicaste [supabase/migrations/002_cardmarket_links.sql](supabase/migrations/002_cardmarket_links.sql), ejecútala una vez en tu proyecto existente. No vuelvas a ejecutar la primera migración.
3. Sube los cambios de este proyecto a tu repositorio personal, manteniendo las carpetas completas y excluyendo `.env.local`, dependencias, compilaciones y copias de la colección. La carpeta `pokemon-collection-para-github` preparada anteriormente es una foto antigua: no se actualiza sola al editar el proyecto original.
4. Despliega el nuevo commit de `main` en Vercel. No hay nuevas variables de entorno ni cambios en las URLs de Supabase.
5. En la web publicada, prueba los filtros y pulsa **Mi colección → Actualizar precios** para actualizar las fichas antiguas. Abre un precio con enlace de producto guardado y comprueba el idioma. La publicación de esta mejora requiere este despliegue; las nuevas expansiones que publique después TCGdex no.

## Copias de seguridad

### Exportar a Excel

En **Mi colección → Exportar Excel** se descarga un archivo `.xlsx` con **toda** la colección, aunque tengas filtros de búsqueda o idioma activos.

- Hoja **Mi colección**: nombre, colección, precio unitario en euros, cantidad, total valorado, idioma, variante, conservación, número, ID, origen y fecha del precio.
- Los importes son números con formato monetario, para poder sumarlos en Excel. El valor manual tiene prioridad; el resto usa la misma referencia que la web, no el mínimo general de ofertas.
- Una carta sin referencia deja precio y total vacíos; un valor manual de cero se conserva como cero. El número de carta mantiene los ceros iniciales.
- Hoja **Información**: fecha de exportación, recuentos y limitaciones de la valoración.
- Se genera en tu navegador: no se envían tus cartas a un servicio de conversión. No incluye correo, tokens, identificadores de propietario ni notas personales. Los nombres se escriben como texto, nunca como fórmulas.
- El generador se carga sólo al pulsar el botón. No se añade al paquete inicial del catálogo.
- **Excel es un informe, no una copia restaurable.** Para recuperar o trasladar los registros con todos sus datos utiliza **Exportar JSON** e **Importar**. No se admite importar Excel.

### Copia JSON restaurable

**Exportar JSON** descarga tus registros, pero nunca contraseñas, tokens de sesión ni identificadores de propietario. Los archivos contienen datos personales de tu colección: guárdalos en un lugar seguro y no los subas a un repositorio público.

**Importar** valida formato, cantidades, idioma, variante e identidad de carta. Antes de escribir solicita confirmación. Reemplaza cantidad, notas, valoración y ficha de coincidencias exactas (carta + idioma + variante + conservación); no borra otras cartas ni suma duplicados. La importación de cada archivo es transaccional. Exporta antes de importar si quieres conservar el estado previo.

Cada parte admite hasta 3000 registros y 5 MB al importar. La exportación divide automáticamente antes de esos límites. Si descargas varias partes, conserva e importa **todas**. Son copias de tus datos, no del servicio Supabase completo.

## Seguridad

- RLS habilitado y forzado: cada usuario solo puede leer o escribir sus propias filas.
- Sin permisos de datos para `anon`. RPC con `security invoker` y `search_path` fijo.
- Las RPC utilizan `auth.uid()` y no confían en propietarios enviados por el cliente.
- El usuario no puede modificar la columna `user_id` ni asignarse otro propietario.
- Restricciones SQL para cantidades, variantes, idiomas, importes y tamaño/coherencia de fichas.
- Se descartan identificadores de usuario al importar. Solo se muestran imágenes HTTPS de `assets.tcgdex.net`.
- La caché de colección se separa por cuenta y se limpia al cambiar de sesión.
- La sesión se conserva en el navegador mediante Supabase. Cierra sesión en equipos compartidos. Cerrar sesión afecta al dispositivo actual.
- Borrar una cuenta desde Supabase elimina su colección por cascada. Exporta antes si la quieres conservar.

Antes de hacer pública la aplicación, revisa SMTP, políticas RLS, límites de autenticación, protección contra abuso/CAPTCHA y cuotas. Las credenciales del hosting y la administración de la base de datos quedan fuera del frontend.

## Desarrollo y pruebas

```sh
npm run lint
npm test
npm run build
```

En este Windows también puedes ejecutar `./Start.ps1 -Check`. Para generar solo la compilación: `./Start.ps1 -Build`.

Pruebas de navegador con Chromium instalado:

```sh
npx playwright install chromium
npm run test:e2e
```

Si no se puede descargar Chromium, usa Edge instalado. En PowerShell:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:e2e
```

- Las pruebas unitarias verifican precios, variantes, validación, copias y consultas del catálogo.
- Las pruebas de Excel vuelven a leer el archivo generado y comprueban importes numéricos, celdas vacías, cero manual, Unicode y nombres que parecen fórmulas. La descarga se prueba también en móvil y escritorio.
- Las pruebas SQL ejecutan la migración sobre PostgreSQL embebido (PGlite), con roles independientes para comprobar RLS, sumas, importación atómica e intentos de acceso entre cuentas.
- Las pruebas de navegador cubren móvil/escritorio, errores del catálogo y el flujo de iniciar sesión, añadir, recargar, editar, exportar, importar, eliminar y cerrar sesión.
- Las pruebas de navegador simulan las respuestas de TCGdex/Supabase: son deterministas y no necesitan claves ni envían datos reales. **No sustituyen una prueba final con tu proyecto Supabase y su correo configurados.**

## Estructura

- [src/App.tsx](src/App.tsx): navegación, catálogo y gestión de colección.
- [src/components](src/components): ficha de carta, imágenes, autenticación y diálogos.
- [src/lib/models.ts](src/lib/models.ts): validación, precios y copias.
- [src/lib/catalog.ts](src/lib/catalog.ts): consultas TCGdex, cancelación y tiempos máximos.
- [src/lib/collection.ts](src/lib/collection.ts): persistencia y RPC.
- [supabase/migrations/001_collection.sql](supabase/migrations/001_collection.sql): esquema, RLS y operaciones de base de datos.
- [tests](tests): pruebas unitarias, de base de datos y navegador.

## Atribución

Proyecto independiente, sin afiliación con Pokémon, Nintendo, Creatures, GAME FREAK, Cardmarket ni TCGdex. Marcas e imágenes pertenecen a sus titulares. Consulta las condiciones y licencias de los proveedores antes de publicar comercialmente o redistribuir datos. El dispositivo decorativo de la cabecera y los motivos geométricos se dibujan con CSS/SVG propios, sin utilizar un logotipo oficial ni presentarse como una aplicación oficial.
