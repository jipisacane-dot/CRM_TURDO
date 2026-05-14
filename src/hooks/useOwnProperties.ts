import { useCallback, useEffect, useState } from 'react';
import { properties as svc } from '../services/properties';
import type { PropertyWithPhotos } from '../services/properties';

export function useOwnProperties() {
  const [items, setItems] = useState<PropertyWithPhotos[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await svc.list());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { items, loading, error, refetch };
}
