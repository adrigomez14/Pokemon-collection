/** Información de privacidad; revisar la identidad legal y la configuración antes de publicar. */
export function PrivacyPage() {
  return <article className="privacy-page stack" aria-labelledby="privacy-heading">
    <header><h1 id="privacy-heading">Privacidad y tus datos</h1><p>Información sobre el uso de datos personales en PokefolioTCG.</p></header>
    <section aria-labelledby="privacy-controller"><h2 id="privacy-controller">Quién es responsable</h2>
      <p>El servicio está gestionado por <strong>PokefolioTCG</strong>. Puedes contactar en <a href="mailto:pokefolio14@gmail.com">pokefolio14@gmail.com</a> para consultas de privacidad y ejercicio de derechos.</p>
    </section>
    <section aria-labelledby="privacy-data"><h2 id="privacy-data">Qué datos se tratan y para qué</h2>
      <ul>
        <li>Datos de cuenta: correo electrónico, identificadores de usuario y datos técnicos de autenticación, para crear la cuenta, iniciar sesión y proteger su acceso. La autenticación y las contraseñas las gestiona Supabase Auth.</li>
        <li>Colecciones: cartas guardadas, cantidades, variantes, estado, valoraciones, notas y enlaces añadidos por ti, para guardar y gestionar tu colección.</li>
        <li>Contacto: tema, mensaje, correo opcional y, si has iniciado sesión, identificador de cuenta, para atender consultas, incidencias o sugerencias. Evita incluir contraseñas o información sensible en mensajes y notas.</li>
        <li>Registros técnicos del servicio: los proveedores pueden tratar direcciones IP, fechas, errores y datos de conexión para operar el servicio, prevenir abusos y mantener su seguridad.</li>
      </ul>
      <p>La prestación de la cuenta y la gestión de la colección se basan en la ejecución del servicio solicitado. La atención de consultas vinculadas al servicio se basa en esa relación o en las medidas previas que solicites; otras comunicaciones y la protección frente a abusos se atienden sobre el interés legítimo de responder y mantener el servicio seguro, sujeto a la ponderación correspondiente. El contacto es voluntario y no se utiliza para enviar publicidad.</p>
    </section>
    <section aria-labelledby="privacy-providers"><h2 id="privacy-providers">Proveedores y enlaces externos</h2>
      <p>Se utilizan Supabase para autenticación y base de datos, Vercel para alojamiento y funciones del servicio, y Google SMTP/Gmail para el envío o recepción de correos y notificaciones. Google Fonts sirve tipografías y TCGdex proporciona información e imágenes del catálogo; al solicitar estos recursos, sus servidores pueden recibir datos técnicos de conexión.</p>
      <p>Los enlaces a Cardmarket abren un sitio externo con sus propias condiciones y política de privacidad. No es necesario acceder a él para gestionar la colección.</p>
      <p>Los proveedores y sus subencargados pueden tratar datos fuera de tu país, incluida la Unión Europea. Puedes solicitar información sobre las ubicaciones y garantías aplicables escribiendo al contacto de privacidad. No se afirma que todos los datos permanezcan en la Unión Europea.</p>
    </section>
    <section aria-labelledby="privacy-storage"><h2 id="privacy-storage">Almacenamiento técnico en el navegador</h2>
      <p>Se utiliza almacenamiento local del navegador (localStorage) para mantener la sesión. La aplicación no incorpora seguimiento publicitario. Si se añaden tecnologías no necesarias, se actualizará esta información y se solicitará el consentimiento que corresponda antes de activarlas.</p>
      <p>Puedes cerrar la sesión o borrar los datos del sitio desde tu navegador. Borrar el almacenamiento local no elimina tu cuenta ni la colección guardada en la nube.</p>
    </section>
    <section aria-labelledby="privacy-retention"><h2 id="privacy-retention">Durante cuánto tiempo</h2>
      <p>La cuenta y la colección se conservan hasta que solicites su eliminación. El borrado de cuenta elimina de la base activa la cuenta, sus colecciones y los mensajes asociados a su identificador. Los mensajes enviados sin sesión no se vinculan automáticamente a una cuenta por compartir correo.</p>
      <p>Los mensajes de contacto tienen un plazo de conservación de seis meses desde su envío. La retención de la base de datos se aplica mediante un borrado SQL diario de los mensajes que superen ese plazo; la tarea debe estar activada y supervisada por el responsable. Puede existir un desfase hasta la siguiente ejecución diaria.</p>
      <p>Las notificaciones y copias de contacto en Gmail requieren una gestión separada por el responsable y no desaparecen al borrar la base de datos. Las copias de seguridad siguen los plazos y procedimientos de cada proveedor; no se promete su eliminación inmediata ni un plazo no verificado. Si existe una obligación legal de conservación o necesidad de atender reclamaciones, el responsable deberá valorar y limitar los datos conservados para ese fin.</p>
    </section>
    <section aria-labelledby="privacy-rights"><h2 id="privacy-rights">Tus opciones y derechos</h2>
      <p>Desde la gestión de cuenta puedes exportar una copia JSON de tu colección, cambiar la contraseña o solicitar el borrado de cuenta. Puedes rectificar los datos de tu colección en la aplicación. La exportación de la colección no incluye necesariamente todos los datos tratados por los proveedores o los mensajes de contacto.</p>
      <p>Para solicitar acceso, rectificación, supresión, portabilidad cuando proceda, oposición o limitación, escribe a <a href="mailto:pokefolio14@gmail.com">pokefolio14@gmail.com</a>. Se podrá solicitar información proporcionada para verificar tu identidad; no envíes tu contraseña. El alcance de cada derecho depende de sus requisitos legales y se informará de las limitaciones aplicables.</p>
      <p>También puedes presentar una reclamación ante la <a href="https://www.aepd.es/" target="_blank" rel="noopener noreferrer">Agencia Española de Protección de Datos (AEPD)</a>, sin perjuicio de acudir a la autoridad competente que corresponda.</p>
    </section>
  </article>
}
