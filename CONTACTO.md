# Activar notificaciones de contacto por Gmail

El formulario guarda cada mensaje en `public.feedback`. Un webhook de Supabase notifica al endpoint `POST /api/feedback-notification` de Vercel, que envía el aviso al buzón indicado. El SMTP de Supabase Auth sigue siendo independiente y no se modifica.

## 1. Variables privadas en Vercel

En tu proyecto → Settings → Environment Variables → Production:

| Nombre | Valor |
| --- | --- |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | Tu dirección Gmail completa |
| `SMTP_PASS` | Contraseña de aplicación de Google, no tu contraseña habitual |
| `CONTACT_TO` | El buzón fijo que recibirá los mensajes |
| `WEBHOOK_SECRET` | El secreto aleatorio que ya generaste (al menos 32 caracteres) |

No uses prefijo `VITE_`. No guardes contraseñas ni el secreto en GitHub, capturas, SQL o el navegador. Marca los secretos como Sensitive. No necesitas `service_role` ni nuevas claves de Supabase. No compartas estas variables con proyectos que no sean tuyos. Para previews, configura credenciales de prueba y un destinatario de prueba, nunca las de producción por defecto.

## 2. Preparar la base de datos

- Si no existe `public.feedback`, ejecuta **una sola vez** [la migración de contacto](supabase/migrations/003_feedback.sql).
- Ejecuta **una sola vez** [la migración de límites](supabase/migrations/004_feedback_limits.sql), antes de activar el webhook.
- No vuelvas a ejecutar las migraciones anteriores. No se borran mensajes ni se modifica tu colección.

Los límites son globales para todo el buzón: un mensaje cada 10 segundos, hasta 10 por hora y 50 por día. Hora y día son ventanas de calendario UTC. Se comprueban en una transacción con bloqueo de fila; cambiar de usuario, navegador o dirección indicada no los evita. Si se supera el límite, el formulario avisa y **no guarda** ese envío.

Estas cuotas limitan el volumen, pero no sustituyen CAPTCHA ni impiden que alguien consuma la cuota e impida temporalmente otros mensajes. Para abrirlo a un público amplio conviene añadir verificación anti-bot en servidor y una cola de correo durable. Gmail está pensado aquí para pruebas pequeñas, no para un servicio público de gran volumen.

## 3. Publicar el código

Sube la versión completa de esta carpeta a tu repositorio personal, sin `.git`, `node_modules`, `dist`, resultados de pruebas ni configuración privada. Incluye la carpeta `api`, el archivo de configuración TypeScript de API y los dos archivos de dependencias, no sólo el frontend.

Despliega el **nuevo commit de main** en Vercel. Las funciones bajo `api` las publica Vercel; no aparecen dentro de `dist` ni se sirven con `npm run dev` de Vite. No hace falta configurar rewrites ni convertir el proyecto a Next.js.

La URL con tu dominio actual será:

**https://pokemon-collection-lac.vercel.app/api/feedback-notification**

Un GET desde el navegador responde **405** (`method_not_allowed`): es correcto, porque sólo acepta POST autenticado. Un 404 indica que no está desplegada la función. Este GET no comprueba SMTP ni envía nada.

## 4. Crear el webhook de Supabase

Después del despliegue y de aplicar los límites:

1. Supabase → Database → Webhooks → Create webhook (activa Database Webhooks si te lo solicita).
2. Nombre: `feedback-email`.
3. Tabla: `public.feedback`.
4. Evento: **INSERT solamente**.
5. Tipo: HTTP Request; método **POST**.
6. URL: la dirección completa de Vercel indicada arriba.
7. Añade estas cabeceras:
   - `Content-Type`: `application/json`
   - `Authorization`: `Bearer TU_WEBHOOK_SECRET`
8. Sustituye `TU_WEBHOOK_SECRET` por **el mismo valor** guardado en Vercel. Debe haber un espacio después de `Bearer`, sin comillas alrededor.
9. Si se puede configurar el timeout, utiliza **10000 ms** en lugar del valor predeterminado corto. Una conexión SMTP puede tardar varios segundos.
10. Guarda. Supabase construye el cuerpo con `type`, `schema`, `table`, `record` y `old_record`; no pegues un cuerpo manual ni la clave pública de Supabase como autorización.

No actives dos webhooks para la misma tabla/evento/destino. Si usas protección de despliegue, el webhook necesita alcanzar esta URL de producción: no uses un dominio de preview protegido por login.

## 5. Prueba final

1. Envía **un solo mensaje de prueba** desde Contacto en la web ya publicada.
2. Comprueba que hay una fila nueva en Supabase → Table Editor → `feedback`.
3. Comprueba la bandeja de entrada y spam de `CONTACT_TO`.
4. Si pulsas Responder, se usa el correo del visitante cuando es válido. Esa dirección es declarada por él: **no está verificada**.

El correo sale de `SMTP_USER`, nunca de la dirección del visitante. No se envían respuestas automáticas al visitante. El cuerpo es texto plano y no carga HTML, URLs ni adjuntos proporcionados por el usuario.

## Diagnóstico y límites de entrega

| Respuesta | Significado |
| --- | --- |
| 200 `smtp_accepted` | El servidor SMTP aceptó el mensaje; no garantiza llegada a la bandeja de entrada. |
| 200 `already_processed` | El mismo ID ya se procesó o estaba procesándose en esa instancia. |
| 401 | Falta la cabecera Bearer, el secreto no coincide o el aviso no está autorizado. |
| 400 / 413 / 415 | Evento, tamaño del cuerpo o Content-Type incorrectos. |
| 503 `not_configured` | Falta alguna variable válida o el secreto es demasiado corto. |
| 502 `smtp_failed` | El servidor SMTP no aceptó el envío o falló la conexión. Revisa variables, contraseña de aplicación y restricciones de Gmail. |

Consulta los registros de Database Webhooks/pg_net en Supabase y los de la función en Vercel. No pegues cuerpos completos ni cabeceras con secretos en chats o tickets.

La notificación HTTP es posterior e independiente del INSERT. Si falla, **el mensaje permanece guardado** y el formulario indica recepción, no entrega de correo. No se ha implementado una cola durable ni un reintento automático: revisa `feedback` si faltan avisos. Un timeout HTTP tampoco demuestra que el correo no se haya enviado; comprueba el buzón antes de repetir.

La deduplicación sólo dura una hora en una misma instancia. Un reinicio, despliegue nuevo o varias instancias pueden producir duplicados; no es entrega exactamente una vez. Los mensajes anteriores a la activación del webhook no se envían retroactivamente. Para rotar el secreto, cambia el valor en Vercel, redespliega y actualiza la cabecera de Supabase.