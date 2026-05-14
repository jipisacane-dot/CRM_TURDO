// Charts del Dashboard extraídos a componente lazy-loadeable
// para no bloquear el first paint con recharts-vendor (120 KB gzip).

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface AgentDatum { name: string; total: number; won: number }
interface ChannelDatum { channel: string; count: number; fill: string }

export default function DashboardCharts({
  agentData,
  channelData,
}: {
  agentData: AgentDatum[];
  channelData: ChannelDatum[];
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-bg-card border border-border rounded-2xl p-5">
        <h3 className="text-white font-semibold mb-4">Consultas por vendedor</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={agentData} barGap={2}>
            <XAxis dataKey="name" tick={{ fill: '#666', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#666', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, color: '#111827' }} />
            <Bar dataKey="total" fill="#8B1F1F" radius={4} name="Total" />
            <Bar dataKey="won" fill="#22C55E" radius={4} name="Ganados" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-bg-card border border-border rounded-2xl p-5">
        <h3 className="text-white font-semibold mb-4">Canales de entrada</h3>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={channelData}
              dataKey="count"
              nameKey="channel"
              cx="50%"
              cy="50%"
              outerRadius={75}
              label={(entry: { name?: string; percent?: number }) => `${entry.name ?? ''} ${((entry.percent ?? 0) * 100).toFixed(0)}%`}
              labelLine={false}
              fontSize={10}
            >
              {channelData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
            </Pie>
            <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, color: '#111827' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
