import { Router } from 'express';
import Stripe from 'stripe';
import express from 'express';
import { prisma } from '../config/database';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/error';
import { PLAN_LIMITS } from '../types';
import { logger } from '../utils/logger';

const router = Router();


const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' })
  : null;

// Get subscription details
router.get('/subscription', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user!.id;

  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });

  const plan = subscription?.plan || 'free';
  const limits = PLAN_LIMITS[plan];

  const monitorCount = await prisma.monitor.count({
    where: { userId },
  });

  res.json({
    ...subscription,
    plan,
    limits,
    usage: {
      monitors: monitorCount,
      monitorsRemaining: limits.maxMonitors - monitorCount,
    },
  });
}));

// Get available plans
router.get('/plans', asyncHandler(async (req, res) => {
  const plans = [
    {
      id: 'free',
      name: 'Free',
      description: 'Perfect for personal projects',
      price: 0,
      priceLabel: 'Free forever',
      priceId: null,
      features: PLAN_LIMITS.free.features,
      limits: {
        maxMonitors: PLAN_LIMITS.free.maxMonitors,
        minInterval: PLAN_LIMITS.free.minInterval,
      },
      popular: false,
    },
    {
      id: 'basic',
      name: 'Basic',
      description: 'For small teams and startups',
      price: 9,
      priceLabel: '$9/month',
      priceId: process.env.STRIPE_PRICE_BASIC || null,
      features: PLAN_LIMITS.basic.features,
      limits: {
        maxMonitors: PLAN_LIMITS.basic.maxMonitors,
        minInterval: PLAN_LIMITS.basic.minInterval,
      },
      popular: true,
    },
    {
      id: 'pro',
      name: 'Pro',
      description: 'For growing businesses',
      price: 29,
      priceLabel: '$29/month',
      priceId: process.env.STRIPE_PRICE_PRO || null,
      features: PLAN_LIMITS.pro.features,
      limits: {
        maxMonitors: PLAN_LIMITS.pro.maxMonitors,
        minInterval: PLAN_LIMITS.pro.minInterval,
      },
      popular: false,
    },
  ];

  res.json({ plans, billingEnabled: !!stripe, checkoutEnabled: !!process.env.STRIPE_PRICE_BASIC && !!process.env.STRIPE_PRICE_PRO });
}));

// Create checkout session
router.post('/checkout', authMiddleware, asyncHandler(async (req, res) => {
  if (!stripe) {
    throw new AppError('Stripe is not configured', 503);
  }

  const userId = req.user!.id;
  const { priceId, plan } = req.body;

  if (!priceId || !plan) {
    throw new AppError('Price ID and plan are required', 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { subscription: true },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  let customerId = user.subscription?.stripeCustomerId;

  // Create real Stripe customer if using placeholder
  if (!customerId || customerId.startsWith('cust_')) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId, source: 'api-monitor-saas' },
    });
    customerId = customer.id;

    await prisma.subscription.upsert({
      where: { userId },
      update: { stripeCustomerId: customerId },
      create: {
        userId,
        stripeCustomerId: customerId,
        plan: 'free',
        status: 'free',
      },
    });
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: 'subscription',
    success_url: `${process.env.FRONTEND_URL}/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/billing?canceled=true`,
    subscription_data: {
      metadata: { userId, plan },
    },
    allow_promotion_codes: true,
  });

  res.json({
    sessionId: session.id,
    url: session.url,
  });
}));

// Create billing portal session
router.post('/portal', authMiddleware, asyncHandler(async (req, res) => {
  if (!stripe) {
    throw new AppError('Stripe is not configured', 503);
  }

  const userId = req.user!.id;

  const subscription = await prisma.subscription.findUnique({
    where: { userId },
  });

  if (!subscription?.stripeCustomerId) {
    throw new AppError('No subscription found', 400);
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${process.env.FRONTEND_URL}/billing`,
  });

  res.json({ url: session.url });
}));

// Stripe webhook (raw body needed)
router.post('/webhook', express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!endpointSecret) {
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig as string, endpointSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Webhook signature verification failed';
    return res.status(400).json({ error: `Webhook Error: ${message}` });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const plan = session.metadata?.plan;

        if (userId && session.subscription) {
          // `line_items` is not expanded on checkout.session.completed, so the
          // price id must come from the subscription itself.
          let subPriceId: string | undefined;
          try {
            const sub = await stripe.subscriptions.retrieve(session.subscription as string);
            subPriceId = sub.items.data[0]?.price?.id;
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'failed to fetch subscription';
            logger.warn(`Could not fetch subscription for user ${userId}: ${message}`);
          }

          await prisma.subscription.update({
            where: { userId },
            data: {
              stripeSubscriptionId: session.subscription as string,
              stripePriceId: subPriceId,
              plan: plan || 'basic',
              status: 'active',
              currentPeriodStart: new Date(),
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            },
          });
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoice.subscription as string;

        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: subId },
          data: {
            status: 'active',
            currentPeriodEnd: new Date(invoice.period_end * 1000),
          },
        });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoice.subscription as string;

        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: subId },
          data: { status: 'past_due' },
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;

        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            status: 'canceled',
            plan: 'free',
            stripeSubscriptionId: null,
            stripePriceId: null,
          },
        });
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;

        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            status: subscription.status,
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          },
        });
        break;
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}));

export default router;
