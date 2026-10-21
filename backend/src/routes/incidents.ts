import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/error';
import { getIncident, listIncidents } from '../services/incidentService';
import { summarizeIncident } from '../services/aiService';
import { listQuerySchema, modeSchema, uuidSchema } from '../schemas/monitor';

const router = Router();

router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const q = listQuerySchema.extend({
    mode: modeSchema,
    status: z.enum(['OPEN', 'RESOLVED']).optional(),
    type: z.enum(['AVAILABILITY', 'LATENCY']).optional(),
    monitorId: z.string().max(64).optional(),
  }).parse(req.query);
  res.json(await listIncidents(req.user!.id, q));
}));

router.get('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) throw new AppError('Incident not found', 404);
  res.json(await getIncident(req.user!.id, id.data));
}));

router.post('/:id/ai-summary', authMiddleware, asyncHandler(async (req, res) => {
  const id = uuidSchema.safeParse(req.params.id);
  if (!id.success) throw new AppError('Incident not found', 404);
  res.json(await summarizeIncident(req.user!.id, id.data));
}));

export default router;
