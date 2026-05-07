import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fmtUSD } from './commissions';
import {
  REASON_LABEL,
  type FunnelByAgent,
  type ResponseTimeStats,
  type ConversionByChannel,
  type ForecastSummary,
  type CaidaReason,
  type SaleCycleStats,
  type MonthlySummaryRow,
} from './analytics';

const CRIMSON = '#8B1F1F';
const TEXT_DARK = '#0F172A';
const TEXT_MUTED = '#64748B';

const drawTurdoLogo = (doc: jsPDF, x: number, y: number, size = 14) => {
  doc.setFillColor(CRIMSON);
  doc.triangle(x, y, x + size, y, x + size * 0.55, y + size * 0.55, 'F');
  doc.setFillColor('#D9D9D9');
  doc.triangle(x, y, x + size * 0.55, y + size * 0.55, x, y + size, 'F');
  doc.setFillColor(CRIMSON);
  doc.circle(x + size * 0.65, y + size * 0.62, size * 0.09, 'F');
};

const fmtMin = (m: number | null): string => {
  if (m == null) return '—';
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 1440) return `${(m / 60).toFixed(1)} hs`;
  return `${(m / 1440).toFixed(1)} d`;
};

const channelLabel = (c: string): string => {
  const map: Record<string, string> = {
    whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook',
    web: 'Sitio web', zonaprop: 'ZonaProp', argenprop: 'ArgenProp',
    mercadolibre: 'MercadoLibre', email: 'Email',
  };
  return map[c] ?? c;
};

interface ReportInput {
  funnel: FunnelByAgent[];
  responseTime: ResponseTimeStats;
  conversion: ConversionByChannel[];
  forecast: ForecastSummary;
  caidas: CaidaReason[];
  saleCycle: SaleCycleStats;
  monthly: MonthlySummaryRow[];
  agentName: (key: string) => string;
}

export const downloadAnalyticsReport = async (input: ReportInput): Promise<void> => {
  const { funnel, responseTime, conversion, forecast, caidas, saleCycle, agentName } = input;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 18;
  let y = margin;

  // ── Header ──────────────────────────────────────────────────────────────
  drawTurdoLogo(doc, margin, y - 2, 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(TEXT_DARK);
  doc.text('Turdo Group — Reporte de Analíticas', margin + 18, y + 3);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(TEXT_MUTED);
  const today = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
  doc.text(today, margin + 18, y + 9);
  y += 22;

  // ── 1. KPIs principales ───────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(TEXT_DARK);
  doc.text('Indicadores principales', margin, y);
  y += 6;

  autoTable(doc, {
    startY: y,
    head: [['Métrica', 'Valor', 'Detalle']],
    body: [
      ['Tasa de respuesta', `${responseTime.tasa_respuesta_pct}%`, `${responseTime.respondidos} de ${responseTime.total_leads} leads`],
      ['Tiempo de 1ra respuesta (mediana)', fmtMin(responseTime.median_response_min), `Promedio ${fmtMin(responseTime.avg_response_min)}`],
      ['Tiempo de 1ra respuesta (P90)', fmtMin(responseTime.p90_response_min), 'El 90% responde en menos de esto'],
      ['Forecast comisiones del mes', fmtUSD(forecast.total_estimado_usd), `${forecast.ops_pendientes_count} ventas pend. + ${forecast.negotiations_activas_count} negociaciones`],
      ['Ciclo de venta promedio', saleCycle.avg_days != null ? `${saleCycle.avg_days} días` : '—', `${saleCycle.total} ventas analizadas`],
    ],
    theme: 'grid',
    headStyles: { fillColor: CRIMSON, textColor: '#FFFFFF', fontSize: 9, fontStyle: 'bold' },
    bodyStyles: { fontSize: 9, textColor: TEXT_DARK },
    columnStyles: {
      0: { cellWidth: 55 },
      1: { cellWidth: 35, halign: 'right', fontStyle: 'bold' },
      2: { cellWidth: 'auto' },
    },
    margin: { left: margin, right: margin },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  // ── 2. Performance por vendedor ──────────────────────────────────────────
  if (y > 230) { doc.addPage(); y = margin; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Performance del equipo', margin, y);
  y += 6;

  const teamRows = funnel
    .filter(f => f.leads_total > 0 || f.ventas_aprobadas > 0)
    .sort((a, b) => b.leads_total - a.leads_total)
    .map(f => {
      const pctResp = f.leads_total > 0 ? Math.round((f.leads_contactados / f.leads_total) * 100) : 0;
      const pctConv = f.leads_total > 0 ? Math.round((f.ventas_aprobadas / f.leads_total) * 100) : 0;
      return [
        agentName(f.agent_key),
        String(f.leads_total),
        String(f.leads_contactados),
        `${pctResp}%`,
        String(f.negociaciones_activas),
        String(f.ventas_aprobadas),
        `${pctConv}%`,
      ];
    });

  if (teamRows.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.text('Sin datos del equipo todavía.', margin, y);
    y += 8;
  } else {
    autoTable(doc, {
      startY: y,
      head: [['Vendedor', 'Leads', 'Contact.', '% Resp.', 'Negoc.', 'Ventas', '% Conv.']],
      body: teamRows,
      theme: 'grid',
      headStyles: { fillColor: CRIMSON, textColor: '#FFFFFF', fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 45 },
        1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' },
        4: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' },
        6: { halign: 'right', fontStyle: 'bold' },
      },
      margin: { left: margin, right: margin },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }

  // ── 3. Conversión por canal ──────────────────────────────────────────────
  if (y > 240) { doc.addPage(); y = margin; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(TEXT_DARK);
  doc.text('Conversión por canal', margin, y);
  y += 6;

  if (conversion.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.text('Sin datos de conversión por canal.', margin, y);
    y += 8;
  } else {
    autoTable(doc, {
      startY: y,
      head: [['Canal', 'Leads', 'Contactados', 'Negociaciones', 'Ventas', '% Conv.']],
      body: conversion.map(c => [
        channelLabel(c.channel),
        String(c.total_leads),
        String(c.leads_contactados),
        String(c.negociaciones),
        String(c.ventas_cerradas),
        `${c.tasa_conversion_pct}%`,
      ]),
      theme: 'grid',
      headStyles: { fillColor: CRIMSON, textColor: '#FFFFFF', fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: {
        1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' },
        4: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' },
      },
      margin: { left: margin, right: margin },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }

  // ── 4. Forecast detallado ────────────────────────────────────────────────
  if (y > 240) { doc.addPage(); y = margin; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(TEXT_DARK);
  doc.text('Forecast de comisiones del mes', margin, y);
  y += 6;
  autoTable(doc, {
    startY: y,
    head: [['Categoría', 'Estimado USD']],
    body: [
      ['Confirmadas (aprobadas, pendientes de cobro)', fmtUSD(forecast.comisiones_confirmadas_usd)],
      [`Probables (${forecast.ops_pendientes_count} ventas pendientes, estimado al 25% del 6%)`, fmtUSD(forecast.forecast_pending_usd)],
      [`Posibles (${forecast.negotiations_activas_count} negociaciones activas, prob. 30%)`, fmtUSD(forecast.forecast_negotiations_usd)],
      ['TOTAL ESTIMADO', fmtUSD(forecast.total_estimado_usd)],
    ],
    theme: 'grid',
    headStyles: { fillColor: CRIMSON, textColor: '#FFFFFF', fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: margin, right: margin },
    didParseCell: (d) => {
      if (d.row.index === 3) {
        d.cell.styles.fillColor = '#F0FDF4';
        d.cell.styles.textColor = '#15803D';
        d.cell.styles.fontStyle = 'bold';
      }
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  // ── 5. Negociaciones caídas ──────────────────────────────────────────────
  if (caidas.length > 0) {
    if (y > 230) { doc.addPage(); y = margin; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(TEXT_DARK);
    doc.text('Motivos de negociaciones caídas', margin, y);
    y += 6;
    autoTable(doc, {
      startY: y,
      head: [['Motivo', 'Cantidad', 'Días promedio hasta caída']],
      body: caidas.map(c => [
        REASON_LABEL[c.reason] ?? c.reason,
        String(c.total),
        `${c.avg_days_to_caida}d`,
      ]),
      theme: 'grid',
      headStyles: { fillColor: CRIMSON, textColor: '#FFFFFF', fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      margin: { left: margin, right: margin },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }

  // ── 6. Ciclo de venta ──────────────────────────────────────────────────
  if (saleCycle.total > 0) {
    if (y > 230) { doc.addPage(); y = margin; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(TEXT_DARK);
    doc.text('Ciclo de venta promedio', margin, y);
    y += 6;

    autoTable(doc, {
      startY: y,
      head: [['Vendedor', 'Ventas', 'Días promedio']],
      body: saleCycle.by_vendor.map(v => [
        v.vendedor_name,
        String(v.total),
        v.avg_days != null ? `${v.avg_days}d` : '—',
      ]),
      theme: 'grid',
      headStyles: { fillColor: CRIMSON, textColor: '#FFFFFF', fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      margin: { left: margin, right: margin },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }

  // ── Footer en última página ────────────────────────────────────────────
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(TEXT_MUTED);
  doc.text('Reporte generado automáticamente por el CRM de Turdo Group', pageW / 2, 287, { align: 'center' });

  const filename = `reporte-analiticas-turdo-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
};
