// Política de Privacidad pública en /privacy. Sin auth — Meta App Review
// debe poder acceder sin login. Compatible con Ley 25.326 (AR), Meta Platform
// Terms y los requisitos para Instagram Graph API.

export default function Privacy() {
  return (
    <div className="min-h-screen bg-white text-[#0F172A] py-10 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Política de Privacidad</h1>
        <p className="text-sm text-gray-500 mb-8">Última actualización: 26 de mayo de 2026</p>

        <div className="prose prose-slate max-w-none space-y-6 text-sm leading-relaxed">

          <section>
            <h2 className="text-xl font-semibold">1. Quiénes somos</h2>
            <p>
              Turdo Estudio Inmobiliario es una operación inmobiliaria con sede en Mar del Plata,
              Provincia de Buenos Aires, República Argentina. Operamos como agencia inmobiliaria
              y ofrecemos servicios de intermediación en compraventa, alquiler y tasación de
              propiedades.
            </p>
            <p>
              <strong>Responsable de los datos:</strong> Leticia Turdo (CUIT/CUIL: 27-30014120-5).<br />
              <strong>Domicilio:</strong> Av. Corrientes 2070, Mar del Plata, Buenos Aires, Argentina.<br />
              <strong>Contacto para temas de privacidad:</strong> turdoleticia@gmail.com
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">2. Qué información recolectamos</h2>
            <p>
              Recolectamos información personal únicamente cuando vos nos la proporcionás voluntariamente
              al contactarnos por nuestros canales digitales (WhatsApp, Instagram, Facebook Messenger,
              formularios web, formularios de Meta Ads) o presencial. Específicamente:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Nombre y apellido</li>
              <li>Teléfono y/o WhatsApp</li>
              <li>Email</li>
              <li>Información de la propiedad que buscás o querés vender (zona, presupuesto, características)</li>
              <li>Conversaciones con nuestros vendedores (mensajes, audios, fotos, videos que vos envíes)</li>
              <li>Identificador interno de la plataforma de origen (por ejemplo, tu ID público de Instagram
                si nos escribiste por DM, para que el vendedor pueda responderte por el mismo canal)</li>
            </ul>
            <p>
              <strong>NO recolectamos:</strong> tu ubicación en tiempo real, tu lista de contactos, tu
              historial de navegación, tus datos bancarios ni información de tarjetas de crédito.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">3. Para qué usamos la información</h2>
            <p>
              Usamos tus datos exclusivamente para:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Responderte sobre la propiedad o consulta que iniciaste</li>
              <li>Coordinar visitas, tasaciones u operaciones inmobiliarias</li>
              <li>Mantener la continuidad de la conversación (que cualquier vendedor que te atienda
                tenga el contexto previo, sin que tengas que repetir la información)</li>
              <li>Cumplir con obligaciones legales y fiscales aplicables en Argentina</li>
              <li>Enviarte propuestas relacionadas con tu búsqueda activa (solo si nos diste contacto)</li>
            </ul>
            <p>
              <strong>NO usamos tus datos para:</strong> venderlos a terceros, hacer publicidad masiva no
              relacionada, perfilarte para fines distintos a tu consulta inmobiliaria, ni los compartimos
              con otras agencias inmobiliarias.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">4. Plataformas que utilizamos</h2>
            <p>
              Para gestionar las consultas usamos un CRM interno desarrollado por Turdo. Este CRM se conecta
              de forma segura con las APIs oficiales de las siguientes plataformas (todas con tu consentimiento
              implícito al iniciar conversación por cada canal):
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>WhatsApp Business Platform</strong> (Meta) — para recibir/enviar mensajes de WhatsApp</li>
              <li><strong>Instagram Graph API</strong> (Meta) — para recibir/responder DMs de Instagram</li>
              <li><strong>Facebook Messenger Platform</strong> (Meta) — para recibir/responder mensajes de Facebook</li>
              <li><strong>ManyChat</strong> — proveedor autorizado por Meta (Business Solution Provider)
                para la entrega técnica de los mensajes</li>
              <li><strong>Meta Ads</strong> — para recibir formularios que vos completes en nuestros anuncios</li>
              <li><strong>Supabase</strong> — base de datos donde guardamos las conversaciones
                (servidores en EE.UU. con cifrado en tránsito y en reposo)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold">5. Cuánto tiempo guardamos tus datos</h2>
            <p>
              Conservamos tu información mientras exista una relación comercial activa o potencial con vos.
              Si nunca completás una operación, conservamos los datos por hasta 24 meses desde el último
              contacto, después de lo cual se anonimizan o eliminan.
            </p>
            <p>
              Si completaste una operación inmobiliaria con nosotros, conservamos la información de esa
              operación por el plazo legal aplicable (10 años para documentación tributaria en Argentina,
              según AFIP).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">6. Tus derechos</h2>
            <p>
              Conforme la Ley 25.326 de Protección de Datos Personales de Argentina, vos tenés derecho a:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Acceder</strong> a los datos personales que tenemos sobre vos</li>
              <li><strong>Rectificar</strong> información incorrecta o desactualizada</li>
              <li><strong>Eliminar</strong> tus datos (excepto los que la ley nos obliga a conservar)</li>
              <li><strong>Oponerte</strong> a que tus datos se usen para fines comerciales</li>
              <li><strong>Solicitar copia portable</strong> de tu información</li>
            </ul>
            <p>
              Para ejercer cualquiera de estos derechos, escribinos a <strong>turdoleticia@gmail.com</strong> con
              copia de tu DNI. Te respondemos en un plazo máximo de 10 días hábiles.
            </p>
            <p>
              También podés hacer un reclamo ante la <strong>Agencia de Acceso a la Información Pública</strong>{' '}
              (autoridad de aplicación en Argentina): <a href="https://www.argentina.gob.ar/aaip" className="text-crimson hover:underline" target="_blank" rel="noopener">argentina.gob.ar/aaip</a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">7. Seguridad</h2>
            <p>
              Todos los datos viajan cifrados (HTTPS/TLS). Las conversaciones se guardan en una base de datos
              con cifrado en reposo, accedida solamente por personal autorizado de Turdo (Leti y los vendedores
              que tienen al cliente asignado). El acceso al CRM requiere usuario y contraseña.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">8. Menores de edad</h2>
            <p>
              No dirigimos nuestros servicios a menores de 18 años. Si descubrimos que tenemos datos de un
              menor sin consentimiento de los padres/tutores, los eliminamos inmediatamente.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">9. Cambios a esta política</h2>
            <p>
              Si actualizamos esta política, la fecha de "Última actualización" arriba va a cambiar. Te
              recomendamos revisarla periódicamente. Los cambios sustanciales te los avisamos por el canal
              por el que estés en contacto con nosotros.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">10. Contacto</h2>
            <p>
              Para cualquier consulta sobre esta política o el uso de tus datos:
            </p>
            <ul className="list-none pl-0 space-y-1">
              <li><strong>Email:</strong> turdoleticia@gmail.com</li>
              <li><strong>WhatsApp:</strong> +54 9 223 525-2984</li>
              <li><strong>Domicilio:</strong> Av. Corrientes 2070, Mar del Plata, Argentina</li>
            </ul>
          </section>

        </div>
      </div>
    </div>
  );
}
