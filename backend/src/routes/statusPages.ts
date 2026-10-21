import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/error';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(3).max(50).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  isPublic: z.boolean().default(true),
  logo: z.string().url().optional(),
  brandColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#3b82f6'),
  monitorIds: z.array(z.string()).min(1),
});

router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const pages = await prisma.statusPage.findMany({
    where: { userId },
    include: {
      items: {
        include: {
          monitor: {
            select: {
              id: true, name: true, url: true, isActive: true,
              checks: { orderBy: { checkedAt: 'desc' }, take: 1, select: { status: true, responseTime: true, checkedAt: true } },
            },
          },
        },
        orderBy: { order: 'asc' },
      },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(pages);
}));

router.post('/', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const data = createSchema.parse(req.body);

  const existing = await prisma.statusPage.findUnique({ where: { slug: data.slug } });
  if (existing) throw new AppError('Slug is already taken', 409);

  const monitors = await prisma.monitor.findMany({ where: { id: { in: data.monitorIds }, userId } });
  if (monitors.length !== data.monitorIds.length) throw new AppError('One or more monitors not found', 404);

  const page = await prisma.statusPage.create({
    data: {
      name: data.name, slug: data.slug, description: data.description,
      isPublic: data.isPublic, logo: data.logo, brandColor: data.brandColor, userId,
      items: { create: data.monitorIds.map((monitorId, index) => ({ monitorId, order: index })) },
    },
    include: { items: { include: { monitor: true } } },
  });

  res.status(201).json(page);
}));

router.get('/public/:slug', asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const page = await prisma.statusPage.findUnique({
    where: { slug },
    include: {
      items: {
        include: {
          monitor: {
            select: {
              id: true, name: true, url: true, isActive: true,
              checks: { orderBy: { checkedAt: 'desc' }, take: 100, select: { status: true, responseTime: true, checkedAt: true, statusCode: true } },
            },
          },
        },
        orderBy: { order: 'asc' },
      },
    },
  });

  if (!page) throw new AppError('Status page not found', 404);
  if (!page.isPublic) throw new AppError('This status page is private', 403);

  const itemsWithStats = page.items.map(item => {
    const checks = item.monitor.checks;
    const total = checks.length;
    const up = checks.filter(c => c.status === 'up').length;
    const uptime = total > 0 ? Math.round((up / total) * 10000) / 100 : 100;
    const avgResponse = total > 0 ? Math.round(checks.reduce((s, c) => s + c.responseTime, 0) / total) : 0;
    return { ...item, monitor: { ...item.monitor, uptime, avgResponseTime: avgResponse, lastCheck: checks[0] || null, checks: undefined } };
  });

  res.json({ ...page, items: itemsWithStats });
}));

router.patch('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user!.id;
  const updateData = req.body;
  const page = await prisma.statusPage.findFirst({ where: { id, userId } });
  if (!page) throw new AppError('Status page not found', 404);
  if (updateData.slug && updateData.slug !== page.slug) {
    const existing = await prisma.statusPage.findUnique({ where: { slug: updateData.slug } });
    if (existing) throw new AppError('Slug is already taken', 409);
  }
  const updated = await prisma.statusPage.update({ where: { id }, data: updateData, include: { items: { include: { monitor: true } } } });
  res.json(updated);
}));

router.delete('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user!.id;
  const page = await prisma.statusPage.findFirst({ where: { id, userId } });
  if (!page) throw new AppError('Status page not found', 404);
  await prisma.statusPage.delete({ where: { id } });
  res.json({ success: true });
}));

export default router;
