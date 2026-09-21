# Poké Ball y guía de instalación móvil

Actualización sobre la PWA publicada en `main`, commit **c3d9ab086c5d10236b79eb522cf3b89fb5d7dcdf**. No es una entrega inicial: la PWA anterior debe estar ya en el repositorio.

## Cambios

- Iconos Android, Apple y favicon con la misma Poké Ball de la cabecera: contorno azul marino, mitad roja/blanca y botón central con las mismas proporciones. El icono instalable tiene fondo claro opaco para conservar el contorno y respetar la zona segura de los recortes del sistema.
- Bloque **«Pokéfolio también en tu móvil»** debajo de la presentación del catálogo. **«Ver pasos para instalar en el móvil»** despliega las instrucciones de Android/Chrome e iPhone/Safari.
- Acceso **«Opciones de instalación»** a la ayuda existente y al botón nativo cuando el navegador lo ofrezca. Se mantiene **«Instalar app»** en el pie.
- Explicación de la misma cuenta y datos, guardado con conexión y limitaciones offline. No se activan notificaciones push.
- Estilos claro/oscuro y móvil, navegación por teclado y devolución del foco al cerrar la ayuda.

## Publicar

1. Sube **el contenido** de **pokemon-collection-logo-guia-pwa** a la raíz de **adrigomez14/Pokemon-collection**, rama `main`, respetando las carpetas.
2. Confirma los cambios desde GitHub y espera **Ready** en Vercel.
3. Abre **https://www.pokefoliotcg.es/catalogo**. Si aparece la actualización, guarda primero tus borradores y acepta actualizar. También puedes cerrar las pestañas de Pokéfolio sin cambios pendientes y volver a abrir.
4. Comprueba el nuevo bloque, despliega los pasos y prueba el botón de opciones. En el móvil instala desde Chrome (Android) o Safari → Compartir → Añadir a pantalla de inicio (iPhone).

**No necesita SQL, migraciones, dependencias nuevas ni cambios de Supabase, SMTP, DNS o variables de entorno.** No subas `.env`, `node_modules`, `dist` ni carpetas de pruebas generadas. No se ha desplegado automáticamente.

La entrega contiene **14 archivos**: código, iconos, pruebas y esta guía. No uses la entrega PWA antigua para sustituir estos cambios. Si modificas GitHub después del commit indicado, integra primero esos cambios para no sobrescribirlos.

## Si el icono antiguo sigue en el móvil

El sistema operativo puede conservar el icono de una instalación anterior y tardar en renovarlo. Después del despliegue, si no cambia, **quita solo la app o el acceso directo de la pantalla de inicio y vuelve a instalarla desde la web actualizada**. Guarda antes cualquier borrador abierto.

Esto no requiere borrar tu cuenta ni la colección de la nube. No pulses «Eliminar cuenta» para renovar el icono. Puede ser necesario volver a iniciar sesión. La instalación y los recortes finales del icono deben comprobarse en el dispositivo real.

## Pruebas

`npm run test:pwa` incluye comprobaciones visuales de la Poké Ball frente al CSS real de la cabecera, dimensiones y opacidad PNG, zona segura, instrucciones, teclado, foco, temas y tamaños de pantalla, además de las pruebas anteriores del worker y actualizaciones. Los eventos de instalación nativa se simulan explícitamente y no certifican la instalación física.

Las pruebas visuales se ejecutan con Playwright; `npm test` continúa siendo la suite unitaria/SQL sin exigir un navegador. El generador de iconos está incluido para futuras modificaciones, pero los tres PNG de esta entrega ya están generados y listos para publicar.
