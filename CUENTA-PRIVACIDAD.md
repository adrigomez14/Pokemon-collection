# Cuenta y privacidad: preparación antes de publicar

La gestión de cuenta y la página de privacidad están integradas en la aplicación. El código local no aplica SQL a ningún servicio: las migraciones se activan manualmente siguiendo esta guía. No se requieren cambios de DNS/SMTP ni nuevas credenciales. Esta preparación no constituye asesoramiento jurídico ni una garantía general de cumplimiento del RGPD.

## Identificación e información

- Datos aportados: nombre público **PokefolioTCG** y correo público **pokefolio14@gmail.com**.
- **Antes de publicar**, confirmar la identidad legal del responsable: la marca o nombre público aportado no sustituye necesariamente al nombre legal de la persona o entidad. Completar la información exigible según su situación y revisar las bases jurídicas, la ponderación del interés legítimo y los procedimientos de derechos.
- Revisar los servicios efectivamente configurados: Supabase, Vercel, Google SMTP/Gmail, Google Fonts y TCGdex; Cardmarket es un enlace externo. Comprobar sus acuerdos, subencargados, regiones y garantías para transferencias internacionales. No se garantiza almacenamiento exclusivamente en la UE.
- No se añade una restricción de edad ni una aceptación ficticia de cookies. Si cambian las tecnologías de seguimiento, revisar información y consentimiento antes de activarlas.

## Preparación SQL (solo por el responsable)

1. Comprobar que la instalación ya tiene las migraciones 001–004. **No repetir 004**: no es idempotente. Tampoco repetir las migraciones iniciales sobre una base que ya las tenga.
2. Revisar y aplicar una vez, como `postgres`, [supabase/migrations/005_account_and_retention.sql](supabase/migrations/005_account_and_retention.sql). Es transaccional y admite reaplicación sin borrar datos. Comprueba la FK de colección `ON DELETE CASCADE`, define la RPC y la función privada de purga. **Desplegar 005 no borra cuentas ni mensajes y no activa la retención diaria.**
3. **Antes de publicar la política de seis meses elegida**, activar la retención automática: Dashboard Supabase → **Integrations → Cron → Enable pg_cron**. Ver [instalación oficial](https://supabase.com/docs/guides/cron/install). Si la extensión no está disponible o no está precargada, resolverlo con la integración o el soporte del proveedor; no introducir credenciales en scripts.
4. Revisar y aplicar una vez, como `postgres`, [supabase/migrations/006_schedule_feedback_retention.sql](supabase/migrations/006_schedule_feedback_retention.sql). Usa la instalación documentada `pg_cron` en `pg_catalog`. Programa `pokefolio-feedback-retention` con `17 3 * * *` y ejecuta únicamente `select pokefolio_private.purge_feedback();`. El mismo nombre y propietario actualizan el job por upsert: [documentación](https://supabase.com/docs/guides/cron/quickstart#edit-a-job). No ejecuta una purga inmediata al aplicar SQL; las futuras ejecuciones sí eliminarán mensajes vencidos.
5. Comprobar en Cron que el job está activo, su propietario es `postgres`, su zona horaria (GMT/UTC por defecto) y la primera ejecución correcta. Supervisar fallos y el historial sin registrar el contenido de mensajes. **No anunciar retención automática operativa hasta verificarla.** No desinstalar la extensión para cambiar este job: afectaría al resto de tareas.

La purga borra mensajes con `created_at < now() - interval '6 months'`: seis meses naturales, no 180 días. El límite exacto se conserva hasta que lo supere. Puede haber un desfase hasta la siguiente ejecución diaria. El contador global de cuotas no contiene los mensajes ni sus identidades y no se elimina con la cuenta.

## Integración disponible

- [src/components/PrivacyPage.tsx](src/components/PrivacyPage.tsx): `PrivacyPage()` sin props; clase `privacy-page`.
- [src/components/AccountModal.tsx](src/components/AccountModal.tsx): `AccountModal(props: AccountModalProps)` recibe usuario, disponibilidad de exportación y callbacks de cierre, borrado y exportación. Se abre desde «Mi colección → Gestionar cuenta» y utiliza los estilos de la aplicación.
- [src/lib/account.ts](src/lib/account.ts):
  - `updateOwnPassword(currentUserId: string, currentEmail: string, currentPassword: string, newPassword: string): Promise<void>`.
  - `deleteOwnAccount(currentUserId: string, currentEmail: string, password: string, confirmation: string): Promise<DeleteOwnAccountResult>`.
  - `DeleteOwnAccountResult = { localSignOutFailed: boolean }`. Resolver significa **borrado confirmado**; un fallo posterior del cierre local no se convierte en un fallo de eliminación.
- SQL: `public.delete_own_account(confirmation text) returns void` y `pokefolio_private.purge_feedback() returns integer`. La segunda solo es ejecutable por su propietario/administración, no por usuarios del navegador.

La exportación descarga la colección en JSON (no todos los datos personales) y cierra el diálogo para no superponer ventanas si hay varias partes. Solo está disponible con una colección cargada y no vacía. El borrado confirmado limpia usuario, colección, cachés y selecciones; no limpia indiscriminadamente el almacenamiento del navegador. Si aparece una cuenta distinta durante la operación, se conserva su interfaz. El aviso final explica cómo limpiar una sesión antigua y las limitaciones de copias de correo.

No se envían correos ni se realizan mutaciones al montar el diálogo. Las contraseñas se mantienen solo temporalmente en el formulario y se vacían al terminar cada operación. Los helpers no las registran ni persisten. `signInWithPassword` sí actualiza la sesión administrada por Supabase y emite eventos de autenticación: no interpretar esos eventos como autorización para borrar.

La reautenticación comprueba identidad antes, en el usuario devuelto y antes de la mutación. La petición de borrado fija el JWT recién obtenido para no cambiar de destinatario si otra pestaña cambia la sesión. La RPC **no acepta un ID objetivo**: solo usa `auth.uid()`. Además exige rol firmado `authenticated`, confirmación exacta `ELIMINAR` y un `amr` de método `password` entre cinco minutos atrás y sesenta segundos adelante. Un `iat` reciente o `token_refresh` no sirven. Referencia: [claims oficiales de JWT](https://supabase.com/docs/guides/auth/jwt-fields). La autorización depende del JWT verificado por PostgREST, nunca de `user_metadata`.

## Borrado, correo, backups y derechos

- El borrado elimina primero los mensajes vinculados a `auth.uid()` y después la cuenta; sus colecciones desaparecen por FK en la misma transacción. No se borra una cuenta de terceros ni se asocian mensajes anónimos comparando correos.
- **Gmail necesita un proceso separado**: revisar periódicamente las notificaciones/copias de contacto (incluidos enviados, archivados y papelera) y eliminar las que superen seis meses; atender antes las solicitudes de supresión que procedan. Limitar esta revisión a los correos de contacto, no borrar otros correos indiscriminadamente. Registrar el control sin copiar contenido personal. La purga SQL no accede a Gmail.
- La eliminación de la base activa no promete el borrado inmediato de backups, registros de proveedores ni correos. Confirmar sus plazos reales y procedimientos de restauración; evitar reintroducir datos suprimidos al restaurar. No se inventa un plazo de backups. Verificar también las limitaciones de revocación de JWT existentes: eliminar una cuenta no equivale por sí mismo a revocar instantáneamente todo token emitido; mantener RLS y comprobar accesos en staging.
- La exportación JSON de la colección no equivale a atender por completo una solicitud de acceso o portabilidad. Tramitar por el correo público los derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad cuando procedan, con verificación proporcionada de identidad y sin pedir contraseñas. Informar de las limitaciones legales y de la posibilidad de reclamar ante la AEPD.

## Verificación local y límites

- Las pruebas locales de cuenta y retención mockean Supabase y ejecutan 001–005 en una base PGlite aislada; no requieren credenciales ni conexiones de producción. Los recorridos de navegador prueban también exportación, edición, contraseña, eliminación rechazada/correcta y navegación integrada con servicios simulados.
- Cubren identidad, confirmación, errores seguros, contraseña mínima, cierre local posterior, aislamiento entre cuentas, transacciones, AMR inválidos/antiguos/futuros, permisos y conservación de datos al desplegar 005.
- La prueba de 006 es **estática**: PGlite no verifica el servicio Cron de Supabase. Quedan pendientes la activación manual, comprobar ejecuciones del job y validar la autenticación y el borrado reales con una cuenta de prueba sin datos valiosos.
