import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/error';

const router = Router();

router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const status = req.query.status as string | undefined;

  const where: Prisma.AlertWhereInput = { userId };
  if (status) where.status = status;

  const [alerts, total] = await Promise.all([
    prisma.alert.findMany({
      where,
      orderBy: { sentAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        monitor: { select: { name: true, url: true } },
      },
    }),
    prisma.alert.count({ where }),
  ]);

  res.json({ alerts, total, page, limit, totalPages: Math.ceil(total / limit) });
}));

router.get('/stats', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const days = parseInt(req.query.days as string) || 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [total, triggered, resolved] = await Promise.all([
    prisma.alert.count({ where: { userId, sentAt: { gte: since } } }),
    prisma.alert.count({ where: { userId, status: 'triggered', sentAt: { gte: since } } }),
    prisma.alert.count({ where: { userId, status: 'resolved', sentAt: { gte: since } } }),
  ]);

  res.json({ total, triggered, resolved, period: { days, since } });
}));

router.patch('/:id/acknowledge', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user!.id;
  const alert = await prisma.alert.findFirst({ where: { id, userId } });
  if (!alert) throw new AppError('Alert not found', 404);
  const updated = await prisma.alert.update({ where: { id }, data: { status: 'acknowledged' } });
  res.json(updated);
}));

export default router;
