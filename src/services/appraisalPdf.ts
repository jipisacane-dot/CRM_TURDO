// Generador de PDF de tasación con branding Turdo.
// Formato similar al de Jorgensen pero con identidad propia.
// 5 páginas: portada → propuesta valor → tasación + comparables → conclusión + recomendaciones → post venta.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Colores Turdo
const CRIMSON = '#8B1F1F';
const DARK = '#0F172A';
const MUTED = '#64748B';
const SOFT_BG = '#F8F9FB';
const ACCENT_LIGHT = '#FCE7E7';

export interface AppraisalData {
  // Property
  property_address: string;
  barrio?: string | null;
  rooms?: number | null;
  bedrooms?: number | null;
  surface_m2?: number | null;
  surface_total_m2?: number | null;
  age_years?: number | null;
  property_state?: string | null;
  has_view?: boolean | null;
  view_type?: string | null;
  amenities?: string[] | null;
  expenses_ars?: number | null;
  floor_number?: number | null;
  exposure?: string | null;
  // Cliente
  client_name?: string | null;
  // Resultado
  suggested_price_low_usd: number;
  suggested_price_high_usd: number;
  comparables: Array<{
    address: string;
    barrio?: string;
    price_usd: number;
    m2: number;
    rooms?: number;
    state?: string;
    age?: number;
    link?: string;
  }>;
  ai_reasoning: string;
  market_summary: string;
  recommendations: string[];
  estimated_sale_days?: number;
  // Asesor
  agent_name: string;
  agent_phone?: string;
  agent_email?: string;
}

const STATE_LABEL: Record<string, string> = {
  a_estrenar: 'A estrenar',
  reciclado: 'Reciclado a estrenar',
  usado_buen_estado: 'Usado, buen estado',
  usado_regular: 'Usado, regular',
};

const VIEW_LABEL: Record<string, string> = {
  al_mar: 'Al mar',
  lateral_mar: 'Lateral al mar',
  a_la_calle: 'A la calle',
  interno: 'Interno',
  otro: 'Otro',
};

const AMENITY_LABEL: Record<string, string> = {
  balcon: 'Balcón',
  ascensor: 'Ascensor',
  cochera: 'Cochera',
  amenities: 'Amenities',
  parrilla: 'Parrilla',
  piscina: 'Piscina',
  sum: 'SUM',
  alarma: 'Alarma',
  mascotas: 'Mascotas permitidas',
  gas_natural: 'Gas natural',
  internet: 'Internet/Cable',
};

// Carga el logo como base64 desde la URL pública.
async function loadLogoAsBase64(): Promise<string | null> {
  try {
    const resp = await fetch('/logo-turdo.png');
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

function fmtUSD(n: number): string {
  return `USD ${n.toLocaleString('es-AR')}`;
}

function safeText(s: string | null | undefined, fallback = '—'): string {
  return s && s.trim() ? s : fallback;
}

export async function generateAppraisalPdf(data: AppraisalData): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  const logoBase64 = await loadLogoAsBase64();

  // ── Helpers ────────────────────────────────────────────────────────────────

  const addPageHeader = (pageTitle: string) => {
    // Banda crimson superior con logo
    doc.setFillColor(CRIMSON);
    doc.rect(0, 0, W, 60, 'F');
    if (logoBase64) {
      try {
        doc.addImage(logoBase64, 'PNG', 24, 12, 110, 36);
      } catch {/* ignore */}
    } else {
      doc.setTextColor('#FFFFFF');
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('Turdo Group', 24, 38);
    }
    doc.setTextColor('#FFFFFF');
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(pageTitle, W - 24, 36, { align: 'right' });
  };

  const addPageFooter = (pageNum: number, totalPages: number) => {
    doc.setDrawColor('#E2E8F0');
    doc.setLineWidth(0.5);
    doc.line(40, H - 40, W - 40, H - 40);
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    doc.setFont('helvetica', 'normal');
    doc.text('Turdo Estudio Inmobiliario · Mar del Plata', 40, H - 24);
    doc.text(`${pageNum} / ${totalPages}`, W - 40, H - 24, { align: 'right' });
  };

  // ── PÁGINA 1: PORTADA ─────────────────────────────────────────────────────

  // Background full crimson en banda superior
  doc.setFillColor(CRIMSON);
  doc.rect(0, 0, W, 280, 'F');

  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 'PNG', (W - 280) / 2, 70, 280, 88);
    } catch {/* ignore */}
  } else {
    doc.setTextColor('#FFFFFF');
    doc.setFontSize(36);
    doc.setFont('helvetica', 'bold');
    doc.text('Turdo Group', W / 2, 130, { align: 'center' });
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('REAL ESTATE & INVESTMENTS', W / 2, 156, { align: 'center' });
  }

  // Título
  doc.setTextColor('#FFFFFF');
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.text('Informe de Tasación', W / 2, 220, { align: 'center' });
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('Análisis profesional de mercado', W / 2, 244, { align: 'center' });

  // Datos del informe
  doc.setTextColor(DARK);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  let cardY = 320;
  const cardX = 60;
  const cardW = W - 120;

  doc.setFillColor(SOFT_BG);
  doc.roundedRect(cardX, cardY, cardW, 180, 10, 10, 'F');
  doc.setTextColor(MUTED);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('PROPIEDAD A TASAR', cardX + 20, cardY + 30);

  doc.setTextColor(DARK);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text(safeText(data.property_address), cardX + 20, cardY + 54);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(MUTED);
  const parts = [
    data.barrio,
    data.rooms ? `${data.rooms} amb` : null,
    data.surface_m2 ? `${data.surface_m2} m²` : null,
    data.property_state ? STATE_LABEL[data.property_state] ?? data.property_state : null,
  ].filter(Boolean);
  doc.text(parts.join('  ·  '), cardX + 20, cardY + 74);

  // Cliente
  if (data.client_name) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(MUTED);
    doc.text('PROPIETARIO', cardX + 20, cardY + 110);
    doc.setTextColor(DARK);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'normal');
    doc.text(data.client_name, cardX + 20, cardY + 130);
  }

  // Fecha + asesor
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(MUTED);
  doc.text('FECHA', cardX + 20, cardY + 152);
  doc.text('ASESOR', cardX + cardW / 2, cardY + 152);
  doc.setTextColor(DARK);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }), cardX + 20, cardY + 168);
  doc.text(data.agent_name, cardX + cardW / 2, cardY + 168);

  // Quiénes somos
  let aboutY = cardY + 220;
  doc.setTextColor(CRIMSON);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Nuestra Historia', 60, aboutY);
  aboutY += 18;
  doc.setTextColor(DARK);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const about = 'Fundada en el año 2015, Turdo Estudio Inmobiliario nació con el propósito de brindar un servicio profesional, transparente y confiable dentro del mercado inmobiliario de Mar del Plata. Desde sus inicios, nos dedicamos exclusivamente a la compra y venta de propiedades, especializándonos en departamentos ubicados en las zonas más destacadas de la ciudad. A lo largo de 12 años de trayectoria, hemos acompañado a cientos de familias en el proceso de encontrar su hogar ideal o concretar la venta al mejor valor de mercado.';
  const aboutLines = doc.splitTextToSize(about, W - 120);
  doc.text(aboutLines, 60, aboutY);

  // ── PÁGINA 2: TASACIÓN + RANGO + COMPARABLES ──────────────────────────────
  doc.addPage();
  addPageHeader('Tasación de mercado');

  let y = 90;
  doc.setTextColor(DARK);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('Valor sugerido de publicación basado en análisis de mercado actual:', 40, y);

  // Card del precio sugerido — gran rectángulo crimson
  y += 20;
  doc.setFillColor(CRIMSON);
  doc.roundedRect(40, y, W - 80, 100, 12, 12, 'F');
  doc.setTextColor('#FFFFFF');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('PRECIO SUGERIDO', W / 2, y + 24, { align: 'center' });
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.text(`${fmtUSD(data.suggested_price_low_usd)}  —  ${fmtUSD(data.suggested_price_high_usd)}`, W / 2, y + 60, { align: 'center' });
  if (data.estimated_sale_days) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Tiempo estimado de venta: ${data.estimated_sale_days} días`, W / 2, y + 84, { align: 'center' });
  }
  y += 130;

  // Tabla de propiedad
  doc.setTextColor(CRIMSON);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Datos de la propiedad', 40, y);
  y += 12;

  const propRows: Array<[string, string]> = [
    ['Dirección', safeText(data.property_address)],
    ['Barrio / Zona', safeText(data.barrio)],
    ['Ambientes', data.rooms ? `${data.rooms}${data.bedrooms ? ` (${data.bedrooms} dorm)` : ''}` : '—'],
    ['Superficie', data.surface_m2 ? `${data.surface_m2} m² cubiertos${data.surface_total_m2 ? ` / ${data.surface_total_m2} m² total` : ''}` : '—'],
    ['Antigüedad', data.age_years !== null && data.age_years !== undefined ? `${data.age_years} años` : '—'],
    ['Estado', data.property_state ? STATE_LABEL[data.property_state] ?? data.property_state : '—'],
    ['Piso', data.floor_number ? `${data.floor_number}° ${data.exposure ?? ''}` : '—'],
    ['Vista', data.has_view ? VIEW_LABEL[data.view_type ?? ''] ?? data.view_type ?? 'Sí' : 'Sin vista destacada'],
    ['Amenities', (data.amenities && data.amenities.length > 0) ? data.amenities.map(a => AMENITY_LABEL[a] ?? a).join(', ') : '—'],
    ['Expensas', data.expenses_ars ? `ARS ${data.expenses_ars.toLocaleString('es-AR')}` : '—'],
  ];

  autoTable(doc, {
    startY: y,
    body: propRows,
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 5, textColor: DARK },
    columnStyles: {
      0: { cellWidth: 130, fontStyle: 'bold', textColor: MUTED },
      1: { cellWidth: 'auto' },
    },
    didDrawCell: (cellData) => {
      if (cellData.section === 'body' && cellData.row.index < propRows.length - 1) {
        // Línea inferior sutil
        doc.setDrawColor('#E2E8F0');
        doc.setLineWidth(0.3);
        doc.line(cellData.cell.x, cellData.cell.y + cellData.cell.height, cellData.cell.x + cellData.cell.width, cellData.cell.y + cellData.cell.height);
      }
    },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 25;

  // Tabla de comparables (si hay espacio en la página, sino salta a próxima)
  if (y > H - 200 && data.comparables.length > 0) {
    doc.addPage();
    addPageHeader('Tasación de mercado (cont.)');
    y = 90;
  }

  if (data.comparables.length > 0) {
    doc.setTextColor(CRIMSON);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Propiedades comparables en el mercado', 40, y);
    y += 6;
    doc.setTextColor(MUTED);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`${data.comparables.length} unidades similares relevadas`, 40, y + 12);
    y += 18;

    autoTable(doc, {
      startY: y,
      head: [['Dirección', 'Barrio', 'Precio', 'm²', 'Amb', 'Estado']],
      body: data.comparables.map(c => [
        safeText(c.address).slice(0, 40),
        safeText(c.barrio).slice(0, 22),
        fmtUSD(c.price_usd),
        c.m2 ? `${c.m2}` : '—',
        c.rooms ? `${c.rooms}` : '—',
        safeText(c.state).slice(0, 18),
      ]),
      theme: 'striped',
      headStyles: { fillColor: CRIMSON, textColor: '#FFFFFF', fontStyle: 'bold', fontSize: 10 },
      styles: { fontSize: 9, cellPadding: 6 },
      alternateRowStyles: { fillColor: ACCENT_LIGHT },
    });
  }

  // ── PÁGINA 3: CONCLUSIÓN + RECOMENDACIONES ───────────────────────────────
  doc.addPage();
  addPageHeader('Análisis y recomendaciones');

  y = 90;

  // Razonamiento IA
  doc.setTextColor(CRIMSON);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Análisis del precio sugerido', 40, y);
  y += 18;
  doc.setTextColor(DARK);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const reasoningLines = doc.splitTextToSize(data.ai_reasoning || 'Sin razonamiento disponible.', W - 80);
  doc.text(reasoningLines, 40, y);
  y += reasoningLines.length * 13 + 15;

  // Mercado
  if (data.market_summary) {
    doc.setTextColor(CRIMSON);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Contexto del mercado', 40, y);
    y += 18;
    doc.setTextColor(DARK);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const marketLines = doc.splitTextToSize(data.market_summary, W - 80);
    doc.text(marketLines, 40, y);
    y += marketLines.length * 13 + 15;
  }

  // Recomendaciones
  if (data.recommendations && data.recommendations.length > 0) {
    if (y > H - 180) {
      doc.addPage();
      addPageHeader('Recomendaciones');
      y = 90;
    }
    doc.setTextColor(CRIMSON);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Recomendaciones para maximizar la venta', 40, y);
    y += 20;
    doc.setTextColor(DARK);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    data.recommendations.forEach((rec) => {
      const lines = doc.splitTextToSize(`✓  ${rec}`, W - 90);
      if (y + lines.length * 13 > H - 70) {
        doc.addPage();
        addPageHeader('Recomendaciones (cont.)');
        y = 90;
      }
      doc.text(lines, 50, y);
      y += lines.length * 13 + 5;
    });
  }

  // ── PÁGINA 4: NUESTRA PROPUESTA + POST VENTA ─────────────────────────────
  doc.addPage();
  addPageHeader('Nuestra propuesta');

  y = 90;
  doc.setTextColor(CRIMSON);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Lo que hacemos para vender tu propiedad', 40, y);
  y += 28;

  const proposals = [
    { icon: '📸', title: 'Fotografías profesionales', desc: 'Sesión completa con luz natural y producción.' },
    { icon: '🎬', title: 'Tour en video + reels', desc: 'Material para Instagram, TikTok y portales.' },
    { icon: '📐', title: 'Plano arquitectónico', desc: 'Plano digital del inmueble para los avisos.' },
    { icon: '✨', title: 'Amueblado virtual con IA', desc: 'Si está vacío, agregamos muebles con IA para que se vea habitado.' },
    { icon: '⭐', title: 'Súper destaque Premier en portales', desc: 'Zonaprop, Argenprop y Mercado Libre con prioridad.' },
    { icon: '📲', title: 'Difusión en redes', desc: 'Instagram, Facebook y campañas en Meta Ads pagadas.' },
  ];

  doc.setFont('helvetica', 'normal');
  proposals.forEach(p => {
    doc.setFillColor(SOFT_BG);
    doc.roundedRect(40, y, W - 80, 38, 8, 8, 'F');
    doc.setTextColor(CRIMSON);
    doc.setFontSize(15);
    doc.text(p.icon, 56, y + 24);
    doc.setTextColor(DARK);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(p.title, 90, y + 17);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(MUTED);
    doc.text(p.desc, 90, y + 30);
    y += 46;
  });

  // Costos post venta
  if (y > H - 200) {
    doc.addPage();
    addPageHeader('Post venta');
    y = 90;
  } else {
    y += 10;
  }

  doc.setTextColor(CRIMSON);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Costos post-venta', 40, y);
  y += 18;

  autoTable(doc, {
    startY: y,
    body: [
      ['Honorarios inmobiliarios', '3% del valor de venta'],
      ['Gastos de escrituración', '4,5% (variable según escribano)'],
      ['Cédula catastral', 'Incluida en escrituración'],
      ['Sellos provinciales', '1,2% (50% comprador, 50% vendedor)'],
    ],
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 6, textColor: DARK },
    columnStyles: {
      0: { cellWidth: 240, fontStyle: 'bold' },
      1: { cellWidth: 'auto', textColor: MUTED },
    },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;

  // Asesor + contacto
  if (y > H - 140) {
    doc.addPage();
    addPageHeader('Contacto');
    y = 90;
  }

  doc.setFillColor(CRIMSON);
  doc.roundedRect(40, y, W - 80, 90, 12, 12, 'F');
  doc.setTextColor('#FFFFFF');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('TU ASESOR', 60, y + 22);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(data.agent_name, 60, y + 44);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  if (data.agent_phone) doc.text(`📱  ${data.agent_phone}`, 60, y + 64);
  if (data.agent_email) doc.text(`✉   ${data.agent_email}`, 60, y + 78);

  // ── Footer en todas las páginas ───────────────────────────────────────────
  const total = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    if (i > 1) addPageFooter(i, total);
  }

  return doc;
}
