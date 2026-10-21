import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase';
import { prisma } from '../config/database';
import { asyncHandler, AppError } from '../middleware/error';

const router = Router();

const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long'),
  name: z.string().min(1, 'Name is required').optional(),
});

const signinSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Sign up
router.post('/signup', asyncHandler(async (req, res) => {
  const { email, password, name } = signupSchema.parse(req.body);

  const { data, error } = await supabaseAdmin.auth.signUp({
    email,
    password,
    options: {
      data: { name },
      emailRedirectTo: `${process.env.FRONTEND_URL}/auth/callback`,
    },
  });

  if (error) {
    console.log('SUPABASE SIGNUP ERROR:', error);
    throw new AppError(error.message, 400);
  }  

  if (data.user) {
    await prisma.user.upsert({
      where: { id: data.user.id },
      update: {
        email,
        username: email.split('@')[0].toLowerCase(),
        name: name || email.split('@')[0],
      },
      create: {
        id: data.user.id,
        email,
        username: email.split('@')[0].toLowerCase(),
        name: name || email.split('@')[0],
      },
    });

    await prisma.subscription.upsert({
      where: { userId: data.user.id },
      update: {},
      create: {
        userId: data.user.id,
        stripeCustomerId: `cust_${data.user.id}`,
        plan: 'free',
        status: 'free',
      },
    });
  }

  res.status(201).json({
    message: 'Account created successfully. Please check your email to verify.',
    user: {
      id: data.user?.id,
      email: data.user?.email,
    },
  });
}));

// Sign in
router.post('/signin', asyncHandler(async (req, res) => {
  const { email, password } = signinSchema.parse(req.body);

  const { data, error } = await supabaseAdmin.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new AppError(
      'Invalid email or password',
      401
    );
  }

  if (data.user?.id) {
    await prisma.user.update({
      where: {
        id: data.user.id,
      },
      data: {
        lastLoginAt: new Date(),
      },
    });
  }

  res.json({
    session: {
      access_token: data.session?.access_token,
      refresh_token: data.session?.refresh_token,
      expires_at: data.session?.expires_at,
    },
    user: data.user,
  });
}));

// Sign out
router.post('/signout', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];

  if (token) {
    await supabaseAdmin.auth.signOut();
  }

  res.json({ message: 'Signed out successfully' });
}));

// Get current user
router.get('/me', asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];

  if (!token) {
    throw new AppError('No token provided', 401);
  }

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    throw new AppError('Invalid token', 401);
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    include: {
      subscription: true,
      _count: {
        select: { monitors: true },
      },
    },
  });

  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: dbUser?.name,
      avatar: dbUser?.avatar,
      createdAt: dbUser?.createdAt,
      subscription: dbUser?.subscription,
      monitorCount: dbUser?._count.monitors,
    },
  });
}));

// Refresh session
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    throw new AppError('Refresh token required', 400);
  }

  const { data, error } = await supabaseAdmin.auth.refreshSession({
    refresh_token,
  });

  if (error) {
    throw new AppError(error.message, 401);
  }

  res.json({
    session: data.session,
    user: data.user,
  });
}));

// Reset password request
router.post('/reset-password', asyncHandler(async (req, res) => {
  const { email } = z.object({ email: z.string().email() }).parse(req.body);

  const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.FRONTEND_URL}/auth/reset-password`,
  });

  if (error) {
    throw new AppError(error.message, 400);
  }

  res.json({ message: 'Password reset email sent. Check your inbox.' });
}));

// Update password
router.post('/update-password', asyncHandler(async (req, res) => {
  const { password } = z.object({
    password: z.string().min(8).max(128),
  }).parse(req.body);

  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];

  if (!token) {
    throw new AppError('No token provided', 401);
  }

  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    throw new AppError("Invalid token", 401);
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    password,
  });

  if (error) {
    throw new AppError(error.message, 400);
  }

  res.json({ message: 'Password updated successfully' });
}));

export default router;
