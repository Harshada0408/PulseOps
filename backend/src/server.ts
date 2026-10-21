import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

import { env } from './config/env';
import {
prisma,
verifyDatabaseConnection,
} from './config/database';

import {
logger,
morganStream,
} from './utils/logger';

import {
errorHandler,
notFound,
} from './middleware/error';

// Routes
import { isExternalAuthProvider } from './auth';
import monitorRoutes from './routes/monitors';
import analyticsRoutes from './routes/analytics';
import billingRoutes from './routes/billing';
import statusPageRoutes from './routes/statusPages';
import alertRoutes from './routes/alerts';
import dashboardRoutes from './routes/dashboard';
import incidentRoutes from './routes/incidents';
import simulationRoutes from './routes/simulation';
import metaRoutes from './routes/meta';

const app = express();
const PORT = env.PORT;

// Security
app.use(
helmet({
contentSecurityPolicy: {
directives: {
defaultSrc: ["'self'"],
styleSrc: [
"'self'",
"'unsafe-inline'",
],
scriptSrc: ["'self'"],
imgSrc: [
"'self'",
'data:',
'https:',
],
},
},
})
);

// CORS
app.use(
cors({
origin: env.isProduction
? [env.FRONTEND_URL]
: [
'http://localhost:3000',
'http://127.0.0.1:3000',
],
credentials: true,
methods: [
'GET',
'POST',
'PUT',
'PATCH',
'DELETE',
'OPTIONS',
],
allowedHeaders: [
'Content-Type',
'Authorization',
],
})
);

// Rate Limiting
const apiLimiter = rateLimit({
windowMs: 15 * 60 * 1000,
// The dashboard polls; 100/15min (the original value) is too low for that.
max: Number(process.env.API_RATE_LIMIT_MAX) || 600,
standardHeaders: true,
legacyHeaders: false,
message: {
error:
'Too many requests, please try again later.',
},
});

const authLimiter = rateLimit({
windowMs: 60 * 60 * 1000,
max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 10,
standardHeaders: true,
legacyHeaders: false,
message: {
error:
'Too many authentication attempts.',
},
});

app.use('/api', apiLimiter);

// Body Parsers
app.use(
express.json({
limit: '10mb',
})
);

app.use(
express.urlencoded({
extended: true,
limit: '10mb',
})
);

// Logging
app.use(
  morgan(
    ':method :url :status :response-time ms',
    {
      stream: morganStream,
      skip: (req) => req.path === '/health',
    }
  )
);

// Health Endpoint
app.get(['/health', '/api/health', '/api/v1/health'], async (_req, res) => {
try {
  await prisma.$queryRaw`SELECT 1`;

  res.status(200).json({
    status: 'healthy',
    database: 'connected',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: env.NODE_ENV,
  });

} catch {
res.status(500).json({
status: 'unhealthy',
database:
'disconnected',
});
}
});

// Root
app.get('/', (_req, res) => {
res.json({
    name: 'PulseOps API',
    version: '1.0.0',
    status: 'running',
endpoints: {
auth: '/api/v1/auth',
monitors:
'/api/v1/monitors',
analytics:
'/api/v1/analytics',
billing:
'/api/v1/billing',
statusPages:
'/api/v1/status-pages',
alerts:
'/api/v1/alerts',
},
});
});

// API Routes
//
// The core's own auth routes are Supabase-specific: they speak Supabase's session
// format and call Supabase directly. When an operator points AUTH_PROVIDER_MODULE at a
// different identity system, that system owns the whole auth surface and mounting these
// would leave a second, half-working sign-in path on the same origin.
if (process.env.AUTH_MODE === 'local' && !isExternalAuthProvider()) {
  // PulseOps built-in auth (email + password stored in PostgreSQL). No external account needed.
  const localAuthRoutes = require('./routes/localAuth').default as import('express').Router;
  app.use('/api/v1/auth', authLimiter, localAuthRoutes);
} else if (!isExternalAuthProvider()) {
  // Required lazily, not imported at the top of this file. `routes/auth` builds a Supabase
  // client as it loads, and that client refuses to construct without a Supabase URL, so a
  // static import would make every deployment crash at startup for a dependency it does
  // not use. The same reasoning applies to `config/supabase`, which is why the resolver
  // in `src/auth` loads its provider on demand too.
  const authRoutes = require('./routes/auth').default as import('express').Router;
  app.use(
    '/api/v1/auth',
    authLimiter,
    authRoutes
  );
}

app.use(
'/api/v1/monitors',
monitorRoutes
);

app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/incidents', incidentRoutes);
app.use('/api/v1/simulation', simulationRoutes);
app.use('/api/v1', metaRoutes);

app.use(
'/api/v1/analytics',
analyticsRoutes
);

app.use(
'/api/v1/billing',
billingRoutes
);

app.use(
'/api/v1/status-pages',
statusPageRoutes
);

app.use(
'/api/v1/alerts',
alertRoutes
);

// Error Middleware
app.use(notFound);
app.use(errorHandler);

// Only start listening when run directly (tests import `app` without opening a port).
if (require.main === module) {
let server:
| ReturnType<
typeof app.listen
>
| undefined;

// Graceful Shutdown
const gracefulShutdown =
async (signal: string) => {
logger.info(`${signal} received. Starting graceful shutdown...`);

if (!server) {
  process.exit(0);
}

server.close(async () => {
  logger.info('HTTP server closed.');

  await prisma.$disconnect();

  logger.info('Database disconnected.');

  process.exit(0);
});

setTimeout(() => {
  logger.error('Forced shutdown after timeout.');

  process.exit(1);
}, 30000);

};

process.on(
'SIGTERM',
() =>
gracefulShutdown(
'SIGTERM'
)
);

process.on(
'SIGINT',
() =>
gracefulShutdown(
'SIGINT'
)
);

process.on(
'uncaughtException',
(err) => {
logger.error('Uncaught Exception:', err);

  process.exit(1);
}
);

process.on(
'unhandledRejection',
(reason) => {
logger.error(
'Unhandled Rejection:',
reason
);
}
);

// Startup
(async () => {
  try {
    await verifyDatabaseConnection();
  } catch (error) {
    logger.error('Database connection verification failed:', error);
    process.exit(1);
  }

  server = app.listen(
    PORT,
    () => {
      logger.info(`🚀 API Monitor Backend running on port ${PORT}`);
      logger.info(`📊 Environment: ${env.NODE_ENV}`);
      logger.info(`🔗 Frontend URL: ${env.FRONTEND_URL}`);
    }
  );
})();

}

export default app;
