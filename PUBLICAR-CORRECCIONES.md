# Publicar las correcciones de Deseos, alertas y preferencias

Preparado sobre **3ef4e16 — preferencias cuenta**. Se conservan el modo nocturno, el fondo, las preferencias de cuenta, las últimas expansiones, la exportación de compras, la publicidad y el diseño que subiste. No se recupera el botón «Refrescar» que eliminaste.

## IMPORTANTE: orden de publicación

Esta actualización **sí necesita una migración nueva**. Primero se aplica 010 en Supabase; después se suben los archivos a GitHub. No se ha aplicado ninguna migración en producción durante el desarrollo.

### 1. Comprobar los requisitos de Supabase

- Deben estar aplicadas las migraciones anteriores, incluidas **008** (precio objetivo) y **009** (alertas de precio).
- Como comprobación visual, en el editor de tablas deben existir la columna `target_price` de `wishlist_items` y la tabla `wishlist_price_alerts`.
- Si 008 o 009 siguen pendientes, usa sus versiones del repositorio actual y respeta el orden. **No repitas las que ya estén aplicadas.** No uses entregas antiguas para sustituir tu código.

### 2. Aplicar solamente la nueva migración

1. Abre el proyecto de Supabase que utiliza Pokéfolio y entra en **SQL Editor → New query**.
2. Abre [la migración 010 incluida](supabase/migrations/010_wishlist_alert_email_delivery.sql), copia su contenido completo y ejecútalo **una sola vez**.
3. Espera a la confirmación de éxito. Si devuelve un error, no continúes con el despliegue ni intentes repetir migraciones antiguas: conserva el mensaje para revisarlo.

010 añade el seguimiento privado de intentos y entregas. No borra cuentas, colecciones, listas ni alertas. Mantiene el aislamiento por usuario y reserva las operaciones de correo al servidor.

**Transición segura:** las alertas antiguas, y las que cree el cron antiguo entre este paso y el despliegue, no entran automáticamente en la nueva cola. Así no se reenvían mensajes cuya entrega anterior se desconoce.

### 3. Subir la actualización a GitHub

1. Abre **pokemon-collection-correcciones-deseos-alertas**, dentro de **EXTENSIONES**.
2. En **adrigomez14/Pokemon-collection**, rama **main**, entra en la raíz y selecciona **Add file → Upload files**.
3. Arrastra **el contenido** de la carpeta, no la carpeta exterior: son **18 archivos de código, configuración, pruebas y migración, más esta guía**.
4. Conserva las rutas y confirma la subida. Es una entrega parcial: **no borres los demás archivos del repositorio**.
5. Espera a que Vercel indique **Ready**. Abre **https://www.pokefoliotcg.es** y recarga; en escritorio puedes usar **Ctrl+F5**.

No hay dependencias nuevas ni cambios necesarios de DNS o del dominio. La subida y el despliegue siguen siendo manuales.

## Qué se ha corregido

- **Añadir deseos:** la inserción ya no envía una columna sin permiso. El objetivo empieza vacío y añadir un duplicado no sobrescribe el importe guardado.
- **Objetivos por lista:** el borrador no pasa a otra lista que contenga la misma carta; guardar, recargar, borrar el objetivo y recuperar errores están probados.
- **Correos:** cola persistente con reintentos ante fallos temporales, incluso si después cambia el precio o falla TCGdex. Se vuelve a comprobar la preferencia de correo, el destinatario actual y que el deseo y su objetivo sigan vigentes.
- **Concurrencia:** una reserva temporal y su token impiden que dos ejecuciones normales procesen simultáneamente el mismo correo. Un proceso interrumpido deja trabajo recuperable.
- **Preferencias:** los eventos de sesión no pisan la búsqueda actual al cambiar el tema. Los guardados rápidos se ordenan y las respuestas de una cuenta anterior no actualizan la siguiente.
- **Notificaciones:** errores visibles, protección contra doble pulsación y marcado limitado a las notificaciones mostradas, no a todos los avisos pendientes.
- **Pruebas:** adaptadas al refresco automático del catálogo, sin restaurar el botón eliminado. No cargan archivos de entorno locales.

## Correo, horarios y límites reales

Se mantiene la programación diaria **09:00 UTC**. No es una alerta en tiempo real. Los intentos pendientes se recuperan en ejecuciones posteriores; con el cron diario, un fallo puede retrasar un correo más de 24 horas.

Por ejecución hay un máximo de **80 deseos consultados y 20 reclamaciones de correo**, además de un presupuesto de tiempo. Puede procesarse menos si los servicios están lentos. El avance queda guardado para continuar en las siguientes ejecuciones; no se limita siempre a las primeras filas de la base de datos.

- Los avisos anteriores a la nueva cola permanecen visibles dentro de la web, pero **no se reenvían retroactivamente** por correo.
- Un correo aceptado por SMTP no garantiza que llegue a la bandeja de entrada. Un rechazo SMTP definitivo queda como fallo, en lugar de reintentarse indefinidamente.
- No es posible garantizar «exactamente una vez» con SMTP: si el servidor acepta un correo y el proceso cae antes de registrar la confirmación, un reintento podría duplicarlo. Las reservas evitan envíos simultáneos, no esa ventana excepcional.

La función utiliza las variables de servidor que ya requería la versión anterior: `CRON_SECRET` (mínimo 32 caracteres), `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` —o el respaldo `VITE_SUPABASE_URL`—, `SMTP_HOST`, `SMTP_PORT` (465 o 587), `SMTP_USER` y `SMTP_PASS`.

No se han leído ni cambiado sus valores. Si faltan, la función no puede operar completamente; sin SMTP configurado no consume los correos pendientes. **Nunca expongas la clave de servicio ni secretos con prefijo VITE_, ni los pegues en el repositorio o en el chat.**

## Comprobación manual tras publicar

1. Añade una carta desde el corazón a dos listas; confirma que tu colección no cambia.
2. Guarda un objetivo, recarga y comprueba que sigue presente. Cambia de lista con un importe sin guardar: no debe arrastrarse.
3. Cambia el idioma del catálogo y busca una expansión. Activa el modo nocturno: la búsqueda debe mantenerse.
4. Guarda preferencias de cuenta y recarga para comprobar que se restauran.
5. Abre la campana y marca avisos como leídos: solo debe afectar al grupo mostrado.
6. Para el correo, revisa la ejecución programada en Vercel y sus contadores. **No hace falta abrir manualmente la API ni disparar correos reales para publicar esta corrección.**

## Validación realizada

- **566 pruebas unitarias y SQL aprobadas**, con PostgreSQL temporal en memoria.
- **128 pruebas de navegador aprobadas** en escritorio y móvil.
- Compilación frontend/API correcta y análisis estático con **0 errores y 0 advertencias**.
- Escenarios de permisos, aislamiento, reintentos, concurrencia, caducidad de reservas y convivencia entre cron antiguo/nuevo comprobados con servicios simulados.

No se han ejecutado SQL, borrados de cuentas ni envíos SMTP reales. No se han creado commits ni realizado push o despliegues.
