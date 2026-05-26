// Términos del Servicio del CRM Turdo. Ruta /terms — pública para Meta App Review.

export default function Terms() {
  return (
    <div className="min-h-screen bg-white text-[#0F172A] py-10 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Términos del Servicio</h1>
        <p className="text-sm text-gray-500 mb-8">Última actualización: 26 de mayo de 2026</p>

        <div className="prose prose-slate max-w-none space-y-6 text-sm leading-relaxed">

          <section>
            <h2 className="text-xl font-semibold">1. Sobre este servicio</h2>
            <p>
              El CRM Turdo (en adelante, "el Servicio") es una plataforma de gestión interna de Turdo
              Estudio Inmobiliario, propiedad de Leticia Turdo (CUIT/CUIL: 27-30014120-5). El Servicio
              permite a los vendedores autorizados de Turdo centralizar las consultas de clientes
              recibidas por canales digitales (WhatsApp, Instagram, Facebook, Email, formularios web) en
              una única bandeja, gestionar propiedades, generar tasaciones y coordinar operaciones
              inmobiliarias.
            </p>
            <p>
              <strong>Este Servicio NO es público.</strong> Solo los empleados, contratistas y socios
              autorizados de Turdo tienen acceso al CRM. Si vos sos un cliente de Turdo, esta página
              de Términos NO te aplica directamente — vos no usás el CRM, vos contactás a Turdo por
              los canales digitales y el CRM es la herramienta interna que usan ellos para responderte.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">2. Quiénes pueden usar el Servicio</h2>
            <p>El Servicio está disponible solamente para:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Empleados y vendedores activos de Turdo Estudio Inmobiliario</li>
              <li>Administradores designados por la titular</li>
              <li>Contratistas de Turdo (por ejemplo, desarrolladores) con permiso explícito</li>
            </ul>
            <p>
              El acceso es por usuario y contraseña. El usuario es responsable de mantener sus credenciales
              seguras y no compartirlas. Cualquier acción realizada con un usuario es responsabilidad del
              titular de ese usuario.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">3. Uso aceptable</h2>
            <p>Al usar el CRM Turdo, los usuarios autorizados se comprometen a:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Usar los datos de los clientes únicamente para los fines comerciales de Turdo (responder
                consultas, coordinar operaciones, etc.)</li>
              <li>No exportar bases de datos completas para uso fuera de Turdo</li>
              <li>No compartir datos personales de clientes con terceros sin autorización expresa</li>
              <li>Respetar el plazo de respuesta esperado y la atención profesional al cliente</li>
              <li>No usar el CRM para spam ni mensajes masivos no autorizados</li>
              <li>Cumplir con las políticas de cada plataforma de mensajería integrada (WhatsApp, Instagram,
                Facebook): ventana de 24h, uso de templates aprobados, no contactar fuera de la relación
                comercial vigente, etc.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold">4. Datos de los clientes</h2>
            <p>
              Los datos de los clientes que se almacenan en el CRM se rigen por nuestra{' '}
              <a href="/privacy" className="text-crimson hover:underline">Política de Privacidad</a>. Los
              usuarios del CRM deben tratar esos datos como confidenciales y usarlos solo dentro del
              marco del Servicio.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">5. Disponibilidad y mantenimiento</h2>
            <p>
              Trabajamos para que el CRM esté disponible 24/7 pero no garantizamos 100% de uptime. Podemos
              realizar mantenimientos planificados (avisados con 24h de anticipación) o de emergencia (si
              hay riesgo de seguridad). No nos hacemos responsables de daños comerciales derivados de
              interrupciones temporales del Servicio.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">6. Integraciones con terceros</h2>
            <p>
              El CRM se integra con servicios externos (Meta, ManyChat, Supabase, Mercado Libre, Tokko,
              Anthropic, OpenAI). Estas integraciones se rigen también por los términos de cada proveedor.
              Si alguna de estas plataformas cambia sus políticas o deja de estar disponible, podemos
              tener que modificar o suspender funcionalidades relacionadas del CRM.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">7. Modificaciones</h2>
            <p>
              Podemos actualizar estos Términos en cualquier momento. Los usuarios autorizados serán
              notificados de cambios sustanciales por el canal interno habitual.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">8. Ley aplicable</h2>
            <p>
              Este Servicio se rige por las leyes de la República Argentina. Cualquier disputa se resolverá
              en los tribunales ordinarios de Mar del Plata, Provincia de Buenos Aires.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">9. Contacto</h2>
            <p>
              Cualquier consulta sobre estos Términos: <strong>turdoleticia@gmail.com</strong>
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
