import { useState, useEffect, useCallback } from 'react';
import { tokko, type CRMProperty } from '../services/tokko';

interface State {
  properties: CRMProperty[];
  loading: boolean;
  error: string | null;
  lastFetch: Date | null;
}

export const useTokkoProperties = () => {
  const [state, setState] = useState<State>({
    properties: [],
    loading: false,
    error: null,
    lastFetch: null,
  });

  const fetch = useCallback(async () => {
    if (!tokko.hasKey()) {
      setState(s => ({ ...s, error: 'API key de Tokko no configurada. Creá el archivo .env.local con VITE_TOKKO_KEY=tu_key' }));
      return;
    }
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const properties = await tokko.getProperties();
      setState({ properties, loading: false, error: null, lastFetch: new Date() });
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: (e as Error).message }));
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return { ...state, refetch: fetch };
};
