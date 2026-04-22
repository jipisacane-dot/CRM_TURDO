import { useState, useEffect, useCallback } from 'react';
import { tokko, type CRMProperty } from '../services/tokko';

interface State {
  properties: CRMProperty[];
  loading: boolean;
  refreshing: boolean; // background refresh (stale data shown)
  error: string | null;
  lastFetch: Date | null;
}

export const useTokkoProperties = () => {
  const [state, setState] = useState<State>({
    properties: [],
    loading: false,
    refreshing: false,
    error: null,
    lastFetch: null,
  });

  const load = useCallback(async (force = false) => {
    if (!tokko.hasKey()) {
      setState(s => ({ ...s, error: 'API key de Tokko no configurada. Creá el archivo .env.local con VITE_TOKKO_KEY=tu_key' }));
      return;
    }

    // If we already have data, show refreshing indicator instead of blocking spinner
    setState(s => ({
      ...s,
      loading: s.properties.length === 0,
      refreshing: s.properties.length > 0,
      error: null,
    }));

    try {
      const properties = await tokko.getProperties(force);
      setState({ properties, loading: false, refreshing: false, error: null, lastFetch: new Date() });
    } catch (e) {
      setState(s => ({ ...s, loading: false, refreshing: false, error: (e as Error).message }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { ...state, refetch: () => load(true) };
};
