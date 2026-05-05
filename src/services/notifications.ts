import { supabase } from './supabase';

export interface NotificationRule {
  rule_key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  threshold_minutes: number | null;
  cooldown_hours: number;
  notify_assigned_agent: boolean;
  notify_admin: boolean;
  push_title: string;
  push_body: string;
  applies_to_stages: string[];
  config: Record<string, unknown>;
  updated_at: string;
}

export type NotificationRuleUpdate = Partial<Pick<NotificationRule,
  'enabled' | 'threshold_minutes' | 'cooldown_hours' |
  'notify_assigned_agent' | 'notify_admin' | 'push_title' | 'push_body' |
  'applies_to_stages' | 'config'
>>;

export const notificationsApi = {
  async list(): Promise<NotificationRule[]> {
    const { data, error } = await supabase
      .from('notification_rules')
      .select('*')
      .order('rule_key');
    if (error) throw error;
    return (data ?? []) as NotificationRule[];
  },

  async update(ruleKey: string, patch: NotificationRuleUpdate): Promise<void> {
    const { error } = await supabase
      .from('notification_rules')
      .update(patch)
      .eq('rule_key', ruleKey);
    if (error) throw error;
  },

  async dryRun(): Promise<{ ok: boolean; sent: number; log: string[] }> {
    const { data, error } = await supabase.functions.invoke('notification-engine', {
      body: { dry_run: true },
    });
    if (error) throw error;
    return data;
  },

  async runNow(): Promise<{ ok: boolean; sent: number; log: string[] }> {
    const { data, error } = await supabase.functions.invoke('notification-engine', {
      body: {},
    });
    if (error) throw error;
    return data;
  },
};
