# Correos de cuenta de Pokéfolio

Las plantillas de registro y recuperación se configuran en **Supabase Auth**, no en el webhook de contacto. Estos archivos sólo cambian el diseño de los mensajes, no las tablas, usuarios ni el envío de Gmail de contacto. Subir los HTML al repositorio **no activa las plantillas automáticamente**.

## Activación

1. Publica [el logotipo PNG](../../public/pokefolio-email.png) dentro de la carpeta `public` de tu repositorio y espera al despliegue de Vercel. No sustituyas el resto de la web por una copia antigua si has hecho nuevos cambios en GitHub.
2. Comprueba que esta URL muestra la imagen sin iniciar sesión: https://pokemon-collection-lac.vercel.app/pokefolio-email.png . No uses una URL de GitHub, un dominio de preview protegido ni un enlace local del ordenador.
3. Abre [las plantillas de Supabase](https://supabase.com/dashboard/project/flvlgsltihkasneplxzt/auth/templates). Configura cada plantilla por separado según la tabla inferior.
4. Copia el asunto indicado en **Subject**.
5. Guarda una copia del cuerpo anterior por si quieres restaurarlo. Después copia TODO el HTML correspondiente en **Body / Source**, sustituyendo el anterior. No incluyas delimitadores de bloque de código.
6. Conserva literalmente `{{ .ConfirmationURL }}` en sus tres apariciones. Supabase lo sustituye por el enlace personal; no pegues enlaces de correos reales, tokens ni claves en la plantilla. No cambies ese marcador por la página de inicio.
7. Revisa la vista previa y guarda cada plantilla. No hay que redesplegar Vercel por cambios de texto en Supabase; sí por publicar la imagen, que se comparte entre los dos correos y sólo se sube una vez.

| Plantilla en Supabase | Asunto | Cuerpo HTML |
| --- | --- | --- |
| Confirm sign up | Confirma tu cuenta de Pokéfolio | [confirm-signup.html](confirm-signup.html) |
| Reset password | Restablece tu contraseña de Pokéfolio | [reset-password.html](reset-password.html) |

## Pruebas después de activar

- **Registro:** usa una cuenta nueva que controles y verifica el botón del correo real.
- **Recuperación:** con una cuenta de prueba existente, abre **Mi cuenta → Olvidé mi contraseña**, solicita un enlace y abre el correo más reciente. Debe mostrar el diseño de recuperación y el botón **Restablecer contraseña**. Al seguirlo, la web debe mostrar **Nueva contraseña**; guarda una contraseña de al menos 12 caracteres y comprueba que puedes cerrar sesión y volver a entrar con ella. No hagas esta prueba sobre cuentas de otras personas.
- En la plantilla **Reset password**, Supabase genera el enlace de recuperación mediante el mismo marcador `{{ .ConfirmationURL }}`. No añadas `type=signup` ni construyas el enlace manualmente. La web ya usa `resetPasswordForEmail` y reconoce el evento `PASSWORD_RECOVERY`.
- No compartas capturas del enlace real ni de la contraseña. Los cambios afectan a próximos envíos; no modifican correos anteriores.

## Subir los dos diseños juntos

La copia de publicación contiene el PNG compartido en `public`, los dos HTML y esta guía en `supabase/templates`, y las pruebas en `tests`. Puedes subir estos archivos juntos manteniendo sus carpetas. No hace falta ejecutar SQL, crear otro webhook, cambiar variables SMTP ni sustituir otros archivos de la web por esta mejora.

## Diseño y compatibilidad

- Emblema del sitio convertido desde [pokefolio.svg](../../public/pokefolio.svg) a PNG de 168 × 168, mostrado a 56 × 56. PNG tiene mejor compatibilidad de correo que SVG.
- Cabecera azul marino, acentos rojo y amarillo, botón para la acción correspondiente y enlace alternativo completo.
- Tablas de presentación y estilos en línea, sin JavaScript, fuentes externas, píxeles de seguimiento ni dependencias de los estilos de la web.
- El nombre y los mensajes son texto real: el botón sigue disponible si el cliente bloquea las imágenes. El modo oscuro y algunos clientes pueden modificar colores o bordes.
- Las pruebas locales usan enlaces ficticios y no envían correos ni cambian contraseñas. La comprobación definitiva se hace con un correo real después de guardar en Supabase.
- No indica un plazo de caducidad fijo porque depende de la configuración de Supabase.
- Cambiar el diseño no garantiza que Gmail deje de clasificar el correo como spam. No cambies SPF/DKIM/DMARC si ya pasan.

Cada HTML corresponde únicamente a la plantilla indicada en la tabla. No pegues el correo de registro en recuperación ni al revés; las demás acciones conservan sus plantillas actuales.