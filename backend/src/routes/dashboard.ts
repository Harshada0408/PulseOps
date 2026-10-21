import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../middleware/error';
import { getDashboardSummary } from '../services/dashboardService';
import { modeSchema, windowSchema } from '../schemas/monitor';

const router = Router();

router.get('/summary', authMiddleware, asyncHandler(async (req, res) => {
  const q = z.object({ mode: modeSchema, window: windowSchema }).parse(req.query);
  res.json(await getDashboardSummary(req.user!.id, q.mode, q.window));
}));

export default router;
