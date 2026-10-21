import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err instanceof AppError) {
    logger.warn(`Operational error: ${err.message}`, {
      statusCode: err.statusCode,
      path: req.path,
      method: req.method,
    });
    return res.status(err.statusCode).json({
      error: err.message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
  }

  if (err instanceof ZodError) {
    const message = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    logger.warn(`Validation error: ${message}`, {
      path: req.path,
      method: req.method,
    });
    return res.status(400).json({
      error: message,
      details: err.errors,
    });
  }

  logger.error('Unexpected error:', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

export const notFound = (req: Request, res: Response) => {
  res.status(404).json({ error: `Route ${req.originalUrl} not found` });
};

export const asyncHandler = (_fn: Function) => {
  return (_req: Request, _res: Response, _next: NextFunction) => {
    Promise.resolve(_fn(_req, _res, _next)).catch(_next);
  };
};
