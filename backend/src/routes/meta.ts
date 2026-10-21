import { Router } from 'express';
import { env } from '../config/env';
import { aiStatus } from '../services/aiService';

const router = Router();

/** Public, non-sensitive facts the Settings page displays. */
router.get('/meta', (_req, res) => {
  res.json({
    name: 'PulseOps',
    version: '1.0.0',
    authMode: env.AUTH_MODE,
    ai: aiStatus(),
    email: { enabled: env.ENABLE_EMAILS && !!env.RESEND_API_KEY },
    scheduler: 'in-process worker (single instance)',
    maxMonitorsPerUser: env.MAX_MONITORS_PER_USER,
  });
});

export default router;
