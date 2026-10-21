import { Request } from 'express';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name?: string | null;
    avatar?: string | null;
  };
}

export interface MonitorPayload {
  name: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  interval?: number;
  timeout?: number;
  expectedStatus?: number;
  expectedKeyword?: string;
  region?: string;
}

export interface CheckResult {
  status: 'up' | 'down' | 'degraded';
  statusCode?: number;
  responseTime: number;
  error?: string;
}

export interface PlanLimits {
  maxMonitors: number;
  minInterval: number;
  maxTeamMembers: number;
  features: string[];
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: {
    maxMonitors: 5,
    minInterval: 300,
    maxTeamMembers: 1,
    features: ['uptime_monitoring', 'email_alerts', '5_min_checks', 'basic_analytics'],
  },
  basic: {
    maxMonitors: 20,
    minInterval: 60,
    maxTeamMembers: 3,
    features: [
      'uptime_monitoring',
      'email_alerts',
      '1_min_checks',
      'status_pages',
      'response_time_tracking',
      'advanced_analytics',
    ],
  },
  pro: {
    maxMonitors: 100,
    minInterval: 30,
    maxTeamMembers: 10,
    features: [
      'all_features',
      'webhook_alerts',
      'slack_alerts',
      '30_sec_checks',
      'advanced_analytics',
      'api_access',
      'custom_domains',
    ],
  },
};

export interface PaginationQuery {
  page?: string;
  limit?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}
