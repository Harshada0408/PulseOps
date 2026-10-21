import { Router } from 'express';
import { prisma } from '../config/database';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/error';

const router = Router();

// Dashboard overview
router.get('/overview', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const days = parseInt(req.query.days as string) || 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Get all user's monitors
  const monitors = await prisma.monitor.findMany({
    where: { userId },
    select: { id: true },
  });

  const monitorIds = monitors.map(m => m.id);

  if (monitorIds.length === 0) {
    return res.json({
      totalMonitors: 0,
      activeMonitors: 0,
      pausedMonitors: 0,
      totalChecks: 0,
      uptimePercentage: 100,
      avgResponseTime: 0,
      alertsTriggered: 0,
      alertsResolved: 0,
      recentIncidents: [],
      responseTimeTrend: [],
      statusDistribution: { up: 0, down: 0, degraded: 0 },
    });
  }

  // Aggregate stats
  const [
    totalChecks,
    upChecks,
    downChecks,
    degradedChecks,
    avgResponseTime,
    totalAlerts,
    resolvedAlerts,
    activeMonitors,
    pausedMonitors,
  ] = await Promise.all([
    prisma.check.count({
      where: { monitorId: { in: monitorIds }, checkedAt: { gte: since } },
    }),
    prisma.check.count({
      where: { monitorId: { in: monitorIds }, status: 'up', checkedAt: { gte: since } },
    }),
    prisma.check.count({
      where: { monitorId: { in: monitorIds }, status: 'down', checkedAt: { gte: since } },
    }),
    prisma.check.count({
      where: { monitorId: { in: monitorIds }, status: 'degraded', checkedAt: { gte: since } },
    }),
    prisma.check.aggregate({
      where: { monitorId: { in: monitorIds }, checkedAt: { gte: since } },
      _avg: { responseTime: true },
    }),
    prisma.alert.count({
      where: { userId, sentAt: { gte: since } },
    }),
    prisma.alert.count({
      where: { userId, status: 'resolved', sentAt: { gte: since } },
    }),
    prisma.monitor.count({ where: { userId, isActive: true, isPaused: false } }),
    prisma.monitor.count({ where: { userId, isPaused: true } }),
  ]);

  // Recent incidents (down alerts)
  const recentIncidents = await prisma.alert.findMany({
    where: {
      userId,
      status: 'triggered',
      sentAt: { gte: since },
    },
    orderBy: { sentAt: 'desc' },
    take: 10,
    include: {
      monitor: { select: { name: true, url: true } },
    },
  });

  // Response time trend (daily averages)
  const responseTimeTrend = await prisma.$queryRaw`
    SELECT 
      DATE(checked_at) as date,
      AVG(response_time)::float as avg_response_time,
      COUNT(*)::int as total_checks
    FROM checks
    WHERE monitor_id = ANY(${monitorIds}::text[]) AND checked_at >= ${since}
    GROUP BY DATE(checked_at)
    ORDER BY date ASC
  `;

  // Status distribution
  const statusDistribution = {
    up: upChecks,
    down: downChecks,
    degraded: degradedChecks,
  };

  // Uptime by monitor
  const uptimeByMonitor = await prisma.$queryRaw`
    SELECT 
      m.id,
      m.name,
      m.url,
      COUNT(*)::int as total,
      SUM(CASE WHEN c.status = 'up' THEN 1 ELSE 0 END)::int as up_count,
      ROUND(AVG(c.response_time)::numeric, 2) as avg_response_time
    FROM monitors m
    LEFT JOIN checks c ON m.id = c.monitor_id AND c.checked_at >= ${since}
    WHERE m.user_id = ${userId}
    GROUP BY m.id, m.name, m.url
    ORDER BY m.created_at DESC
  `;

  res.json({
    totalMonitors: monitors.length,
    activeMonitors,
    pausedMonitors,
    totalChecks,
    uptimePercentage: totalChecks > 0
      ? Math.round((upChecks / totalChecks) * 10000) / 100
      : 100,
    avgResponseTime: Math.round(avgResponseTime._avg.responseTime || 0),
    alertsTriggered: totalAlerts,
    alertsResolved: resolvedAlerts,
    recentIncidents,
    responseTimeTrend,
    statusDistribution,
    uptimeByMonitor,
  });
}));

// Uptime report for specific monitor
router.get('/uptime/:monitorId', authMiddleware, asyncHandler(async (req, res) => {
  const { monitorId } = req.params;
  const userId = req.user!.id;
  const days = parseInt(req.query.days as string) || 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const monitor = await prisma.monitor.findFirst({
    where: { id: monitorId, userId },
  });

  if (!monitor) {
    throw new AppError('Monitor not found', 404);
  }

  // Hourly uptime for last 24h
  const hourlyUptime = await prisma.$queryRaw`
    SELECT 
      DATE_TRUNC('hour', checked_at) as hour,
      COUNT(*)::int as total,
      SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END)::int as up_count,
      AVG(response_time)::float as avg_response_time
    FROM checks
    WHERE monitor_id = ${monitorId} AND checked_at >= ${new Date(Date.now() - 24 * 60 * 60 * 1000)}
    GROUP BY DATE_TRUNC('hour', checked_at)
    ORDER BY hour ASC
  `;

  // Daily uptime for selected period
  const dailyUptime = await prisma.$queryRaw`
    SELECT 
      DATE(checked_at) as date,
      COUNT(*)::int as total,
      SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END)::int as up_count,
      SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END)::int as down_count,
      AVG(response_time)::float as avg_response_time,
      MAX(response_time)::int as max_response_time,
      MIN(response_time)::int as min_response_time
    FROM checks
    WHERE monitor_id = ${monitorId} AND checked_at >= ${since}
    GROUP BY DATE(checked_at)
    ORDER BY date DESC
  `;

  // Incident timeline
  const incidents = await prisma.alert.findMany({
    where: {
      monitorId,
      sentAt: { gte: since },
    },
    orderBy: { sentAt: 'desc' },
    select: {
      id: true,
      status: true,
      message: true,
      sentAt: true,
      resolvedAt: true,
    },
  });

  res.json({
    monitor: { id: monitor.id, name: monitor.name, url: monitor.url },
    hourlyUptime,
    dailyUptime,
    incidents,
    period: { days, since },
  });
}));

// Response time analytics
router.get('/response-time/:monitorId', authMiddleware, asyncHandler(async (req, res) => {
  const { monitorId } = req.params;
  const userId = req.user!.id;
  const days = parseInt(req.query.days as string) || 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const monitor = await prisma.monitor.findFirst({
    where: { id: monitorId, userId },
  });

  if (!monitor) {
    throw new AppError('Monitor not found', 404);
  }

  // Percentiles
  const percentiles = await prisma.$queryRaw`
    SELECT 
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time) as p50,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY response_time) as p75,
      PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY response_time) as p90,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time) as p95,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time) as p99,
      AVG(response_time)::float as avg,
      MAX(response_time)::int as max,
      MIN(response_time)::int as min
    FROM checks
    WHERE monitor_id = ${monitorId} AND checked_at >= ${since}
  `;

  // Response time distribution (buckets)
  const distribution = await prisma.$queryRaw`
    SELECT 
      CASE 
        WHEN response_time < 200 THEN '0-200ms'
        WHEN response_time < 500 THEN '200-500ms'
        WHEN response_time < 1000 THEN '500ms-1s'
        WHEN response_time < 2000 THEN '1-2s'
        WHEN response_time < 5000 THEN '2-5s'
        ELSE '5s+'
      END as bucket,
      COUNT(*)::int as count
    FROM checks
    WHERE monitor_id = ${monitorId} AND checked_at >= ${since}
    GROUP BY 1
    ORDER BY MIN(response_time)
  `;

  // Hourly response time trend
  const hourlyTrend = await prisma.$queryRaw`
    SELECT 
      DATE_TRUNC('hour', checked_at) as hour,
      AVG(response_time)::float as avg_response_time,
      MAX(response_time)::int as max_response_time,
      MIN(response_time)::int as min_response_time,
      COUNT(*)::int as total
    FROM checks
    WHERE monitor_id = ${monitorId} AND checked_at >= ${new Date(Date.now() - 24 * 60 * 60 * 1000)}
    GROUP BY DATE_TRUNC('hour', checked_at)
    ORDER BY hour ASC
  `;

  res.json({
    monitor: { id: monitor.id, name: monitor.name },
    percentiles: percentiles[0],
    distribution,
    hourlyTrend,
    period: { days, since },
  });
}));

export default router;
