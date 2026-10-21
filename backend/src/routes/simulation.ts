import { Router } from 'express';
import { z } from 'zod';
import {
  ensureSimulationMonitor, resetSimulation, runScenario, SCENARIOS, SCENARIO_IDS, SimulationClockError, type ScenarioId,
} from '@pulseops/core';
import { sqlDb } from '../config/sql';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/error';

/**
 * Controlled failure simulation. There is NO URL parameter anywhere in this router: scenarios are
 * fixed server-side fixtures fed to the incident engine for a dedicated simulated monitor, so it
 * cannot be used to make the server fetch anything.
 */
const router = Router();

router.get('/scenarios', authMiddleware, asyncHandler(async (req, res) => {
  const { id, created } = await ensureSimulationMonitor(sqlDb, req.user!.id);
  res.json({
    monitorId: id,
    created,
    scenarios: SCENARIO_IDS.map((s) => ({ id: s, title: SCENARIOS[s].title, description: SCENARIOS[s].description, checks: SCENARIOS[s].steps.length })),
  });
}));

router.post('/run', authMiddleware, asyncHandler(async (req, res) => {
  const { scenario } = z.object({ scenario: z.enum(SCENARIO_IDS as [ScenarioId, ...ScenarioId[]]) }).strict().parse(req.body);
  const { id } = await ensureSimulationMonitor(sqlDb, req.user!.id);
  try {
    const r = await runScenario(sqlDb, id, scenario);
    res.json({
      monitorId: id, scenario: r.scenario, checksRecorded: r.checksRecorded, observationType: 'SIMULATED',
      incidentsOpened: r.opened.map((o) => ({ id: o.id, type: o.type })),
      incidentsResolved: r.resolved.map((o) => ({ id: o.id, type: o.type })),
    });
  } catch (e) {
    if (e instanceof SimulationClockError) throw new AppError(e.message, 409);
    throw e;
  }
}));

router.post('/reset', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = await ensureSimulationMonitor(sqlDb, req.user!.id);
  await resetSimulation(sqlDb, id);
  res.json({ monitorId: id, reset: true });
}));

export default router;
