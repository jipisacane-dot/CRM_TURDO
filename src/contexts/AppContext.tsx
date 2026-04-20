import React, { createContext, useContext, useState, type ReactNode } from 'react';
import type { Lead, Agent } from '../types';
import { LEADS as initialLeads, AGENTS } from '../data/mock';

interface AppContextType {
  currentUser: Agent;
  leads: Lead[];
  setLeads: React.Dispatch<React.SetStateAction<Lead[]>>;
  assignLead: (leadId: string, agentId: string) => void;
  updateLeadStatus: (leadId: string, status: Lead['status']) => void;
  unreadCount: number;
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const currentUser = AGENTS.find(a => a.id === 'leticia')!;

  const assignLead = (leadId: string, agentId: string) => {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, assignedTo: agentId, status: l.status === 'new' ? 'contacted' : l.status } : l));
  };

  const updateLeadStatus = (leadId: string, status: Lead['status']) => {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status } : l));
  };

  const unreadCount = leads.reduce((sum, lead) =>
    sum + lead.messages.filter(m => !m.read && m.direction === 'in').length, 0);

  return (
    <AppContext.Provider value={{ currentUser, leads, setLeads, assignLead, updateLeadStatus, unreadCount }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
