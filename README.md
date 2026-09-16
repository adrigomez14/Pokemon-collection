# Pokéfolio · Tu colección Pokémon TCG

Aplicación web personal en español, adaptable a móvil y ordenador. React + TypeScript + Vite en el navegador; Supabase para autenticación y PostgreSQL; TCGdex para catálogo, imágenes y referencias de Cardmarket.

## Qué puedes hacer

- Buscar cartas por nombre, expansión (su ID) y número, con paginación.
- Consultar catálogos en español, inglés y japonés. El nombre se busca en el idioma seleccionado: por ejemplo, **ピカチュウ** en japonés.
- Ver la imagen de cada carta cuando el proveedor la tenga disponible.
- Crear una cuenta, confirmar el correo, iniciar/cerrar sesión y recuperar la contraseña.
- Guardar cantidades, idioma, variante, conservación, notas y valoración manual opcional.
- Editar registros o eliminarlos con confirmación. Añadir otra copia del mismo registro suma su cantidad de forma atómica, conservando las notas y el valor manual anteriores.
- Consultar y actualizar referencias de Cardmarket, con fecha de origen y enlace de búsqueda.
- Filtrar y ordenar tu colección; ver cantidades, valoración orientativa y ejemplares sin precio.
- Exportar e importar copias JSON. Las colecciones grandes se dividen en partes descargables y restaurables.

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
2. Abre **SQL Editor → New query**. Copia y ejecuta **una sola vez**, en un proyecto nuevo, el contenido de [supabase/migrations/001_collection.sql](supabase/migrations/001_collection.sql).
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

## Cómo interpretar los precios

La aplicación **no hace scraping de Cardmarket** ni requiere acceso a su API comercial. Consulta [TCGdex](https://tcgdex.dev/markets-prices), que incluye precios de mercado en las fichas.

- Solo se usan datos cuyo `unit` es `EUR`.
- Las referencias cero del feed se consideran no disponibles por precaución: no demuestran que una carta valga cero. Un valor manual de cero sí se respeta.
- Normal utiliza `pricing.cardmarket.trend`; Holo utiliza el campo `trend-holo`, según la nomenclatura del proveedor.
- Reverse y primera edición no heredan precios de otra variante: usa la valoración manual tras verificar el producto en Cardmarket.
- No se sustituyen precios españoles o japoneses por los de la ficha inglesa. Si faltan, se muestra **Sin precio**.
- Los datos de mercado no están ajustados al idioma, conservación, graduación o ejemplar concreto. No son una oferta de compra, una tasación ni una promesa de venta.
- La fecha mostrada es la del proveedor. **Actualizar precios** vuelve a consultar los últimos datos disponibles; no crea un precio nuevo ni altera valores manuales. Si falla una consulta, se conserva la referencia anterior y se avisa.
- El enlace de Cardmarket abre una **búsqueda por nombre y número**, no una correspondencia de producto garantizada. Comprueba expansión, número, variante e idioma en los resultados, especialmente en cartas japonesas.
- La valoración total es la suma de cantidad × (valor manual si existe, o referencia disponible). Los ejemplares sin precio se contabilizan aparte y no se tasan como si valieran cero. No se incluyen portes.

TCGdex puede carecer de imágenes de ciertas cartas o idiomas. En ese caso se muestra un marcador explícito, sin presentar una imagen de otro idioma como si fuera la correcta. Se usan recursos alojados por el proveedor; no se distribuye una copia completa del catálogo.

## Copias de seguridad

**Exportar** descarga tus registros, pero nunca contraseñas, tokens de sesión ni identificadores de propietario. Los archivos contienen datos personales de tu colección: guárdalos en un lugar seguro y no los subas a un repositorio público.

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

Proyecto independiente, sin afiliación con Pokémon, Nintendo, Creatures, GAME FREAK, Cardmarket ni TCGdex. Marcas e imágenes pertenecen a sus titulares. Consulta las condiciones y licencias de los proveedores antes de publicar comercialmente o redistribuir datos. La ilustración decorativa de la cabecera es un diseño propio, no una carta real.
