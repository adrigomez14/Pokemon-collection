# Pokéfolio: actualización del álbum físico

## Novedades

- Catálogo y expansiones solo de cartas físicas: se excluye la serie TCG Pocket también de la búsqueda global y de la selección de la última expansión.
- Barra de progreso por expansión e idioma. Cuenta identificadores distintos, incluyendo secretas disponibles en TCGdex: varias copias o variantes no inflan el porcentaje.
- «Todas», «Me faltan» y «Ya tengo» en una expansión. Los filtros personales requieren iniciar sesión y cargar la colección; se aplican antes de paginar.
- Selector de expansión en «Mi colección» y gestión de repetidas. Se agrupan carta + idioma + variante, sumando sus estados de conservación. Una normal y una holo se mantienen separadas. La ficha permite editar cantidades o eliminar un registro con confirmación, sin borrados automáticos ni ventas.
- «Mi colección → Gestionar cuenta»: exportar copia JSON, cambiar contraseña y eliminar la cuenta con contraseña actual y confirmación «ELIMINAR».
- Privacidad con los datos públicos aportados: PokefolioTCG y pokefolio14@gmail.com, proveedores, derechos y retención de contacto de seis meses.
- Rutas que se conservan al recargar, metadatos para compartir, imagen social, sitemap y exclusión de la colección privada de indexación.

Los registros de Pocket que ya estuvieran guardados **no se borran**. Esta actualización no modifica DNS, SMTP, variables de entorno ni las migraciones anteriores.

## Antes de subir a GitHub

1. Conserva una copia JSON de tu colección.
2. Revisa [CUENTA-PRIVACIDAD.md](CUENTA-PRIVACIDAD.md). Confirma la identidad legal que debe figurar detrás del nombre público antes de abrir la web a más personas y revisa los acuerdos y plazos de los proveedores. El texto preparado no certifica cumplimiento legal.
3. En Supabase → SQL Editor, revisa y ejecuta **solo** [supabase/migrations/005_account_and_retention.sql](supabase/migrations/005_account_and_retention.sql) como `postgres`. Define el borrado de la propia cuenta y la función de retención; aplicarla no elimina datos.
4. Activa **Integrations → Cron → Enable pg_cron**. Después revisa y ejecuta [supabase/migrations/006_schedule_feedback_retention.sql](supabase/migrations/006_schedule_feedback_retention.sql) como `postgres`. Programa la limpieza diaria: sus futuras ejecuciones sí eliminan los mensajes de más de seis meses naturales.
5. Comprueba que el job `pokefolio-feedback-retention` está activo y su ejecución finaliza correctamente. Es necesario para la retención automática anunciada; subir el SQL a GitHub **no lo ejecuta en Supabase**.
6. Establece una revisión periódica para eliminar también las copias antiguas de mensajes de contacto en Gmail. La tarea de la base de datos no borra correos.

**No vuelvas a ejecutar las migraciones 001–004. No se necesita una clave de servicio en el navegador ni nuevas claves SMTP.**

## Subida mediante la web de GitHub

La carpeta de entrega `pokemon-collection-actualizacion-album` contiene únicamente archivos nuevos o modificados para esta actualización.

1. Abre `adrigomez14/Pokemon-collection`, rama `main`, en su raíz.
2. Pulsa **Add file → Upload files**.
3. Arrastra el **contenido** de la carpeta de entrega: las carpetas `src`, `public`, `supabase`, `tests` y los archivos de su raíz. No arrastres la carpeta contenedora, para no crear un nivel extra.
4. Confirma la subida y espera a que Vercel indique **Ready**.
5. Abre https://www.pokefoliotcg.es y recarga. No cambies DNS ni la configuración de correo para esta actualización.

No subas carpetas de dependencias, compilación, resultados de pruebas ni archivos de variables de entorno. No utilices las carpetas antiguas de actualización para esta entrega.

## Comprobación después del despliegue

- Busca una expansión: Pocket no debe aparecer; se conserva la ordenación por rareza.
- Inicia sesión y selecciona expansión e idioma: comprueba progreso, «Me faltan» y «Ya tengo».
- En la colección, filtra «Repetidas» y edita una cantidad: el total extra debe actualizarse sin afectar a otras variantes.
- Recarga las secciones de contacto y privacidad: deben conservar su página.
- Prueba el borrado **con una cuenta desechable**, nunca con la colección que quieras conservar. Debe requerir contraseña y confirmación y eliminar únicamente esa cuenta y sus datos vinculados.
- Comprueba el historial de Cron y supervisa futuros fallos. La automatización se ha probado a nivel de SQL y configuración local; su servicio real depende de esta activación manual.

La preparación local no publica automáticamente ningún cambio ni ejecuta operaciones en producción.
