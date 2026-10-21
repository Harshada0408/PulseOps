import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/error';
import {
  createMonitorSchema, updateMonitorSchema, listQuerySchema, modeSchema, windowSchema, uuidSchema,
} from '../schemas/monitor';
import {
  createMonitor, deleteMonitor, getMonitorDetail, listMonitors, listResults, setPaused, updateMonitor,
} from '../services/monitorService';
import { runManualCheck } from '../services/checkService';
import { listIncidents } from '../services/incidentService';

/**
 * Thin controllers: parse/validate, call a service, shape the response.
 * All business logic lives in services/ and @pulseops/core.
 */
const router = Router();

// Manual checks make outbound requests, so they get their own, tighter limit.
const manualCheckLimiter = rateLimit({
  windowMs: 60 * 1000, max: Number(process.env.MANUAL_CHECK_RATE_LIMIT) || 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many manual checks, please slow down.' },
});

const idParam = (raw: string) => {
  const parsed = uuidSchema.safeParse(raw);
  // Monitors created by older versions have non-UUID ids; accept any short safe token.
  if (parsed.success) return parsed.data;
  if (/^[A-Za-z0-9_-]{8,64}$/.test(raw)) return raw;
  throw new AppError('Monitor not found', 404);
};

router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const q = listQuerySchema.extend({ mode: modeSchema, search: z.string().max(100).optional() }).parse(req.query);
  res.json(await listMonitors(req.user!.id, q));
}));

router.post('/', authMiddleware, asyncHandler(async (req, res) => {
  res.status(201).json(await createMonitor(req.user!.id, createMonitorSchema.parse(req.body)));
}));

router.get('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const q = z.object({ window: windowSchema }).parse(req.query);
  res.json(await getMonitorDetail(req.user!.id, idParam(req.params.id), q.window));
}));

router.patch('/:id', authMiddleware, asyncHandler(async (req, res) => {
  res.json(await updateMonitor(req.user!.id, idParam(req.params.id), updateMonitorSchema.parse(req.body)));
}));

router.delete('/:id', authMiddleware, asyncHandler(async (req, res) => {
  await deleteMonitor(req.user!.id, idParam(req.params.id));
  res.status(204).send();
}));

router.post('/:id/pause', authMiddleware, asyncHandler(async (req, res) => {
  res.json(await setPaused(req.user!.id, idParam(req.params.id), true));
}));

router.post('/:id/resume', authMiddleware, asyncHandler(async (req, res) => {
  res.json(await setPaused(req.user!.id, idParam(req.params.id), false));
}));

router.post('/:id/check', authMiddleware, manualCheckLimiter, asyncHandler(async (req, res) => {
  res.json(await runManualCheck(req.user!.id, idParam(req.params.id)));
}));

router.get('/:id/results', authMiddleware, asyncHandler(async (req, res) => {
  const q = listQuerySchema.parse(req.query);
  res.json(await listResults(req.user!.id, idParam(req.params.id), q.page, q.limit));
}));

router.get('/:id/incidents', authMiddleware, asyncHandler(async (req, res) => {
  const q = listQuerySchema.extend({ mode: modeSchema }).parse(req.query);
  res.json(await listIncidents(req.user!.id, { ...q, monitorId: idParam(req.params.id) }));
}));

export default router;
