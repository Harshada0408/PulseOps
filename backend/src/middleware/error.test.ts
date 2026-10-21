import { Request, Response } from 'express';
import { z } from 'zod';
import { AppError, errorHandler, notFound, asyncHandler } from './error';

const mockRes = () => {
  const res = { statusCode: 200 } as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const mockReq = (partial: Partial<Request> = {}) =>
  ({ headers: {}, method: 'GET', path: '/api/v1/test', ...partial }) as Request;

describe('errorHandler', () => {
  it('returns 400 with details for ZodError (validation)', () => {
    const err = new z.ZodError([
      { code: 'too_small', minimum: 1, type: 'string', inclusive: true, exact: false, message: 'Too small', path: ['name'] },
    ]);
    const res = mockRes();
    errorHandler(err, mockReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('name'),
        details: expect.any(Array),
      })
    );
  });

  it('returns 400 for ZodError even in production (no stack leak)', () => {
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const err = new z.ZodError([
      { code: 'invalid_type', expected: 'string', received: 'number', message: 'Expected string', path: ['url'] },
    ]);
    const res = mockRes();
    errorHandler(err, mockReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload).not.toHaveProperty('stack');
    process.env.NODE_ENV = oldEnv;
  });

  it('uses AppError statusCode for operational errors', () => {
    const err = new AppError('Rate limited', 429);
    const res = mockRes();
    errorHandler(err, mockReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Rate limited' }));
  });

  it('returns 500 for unexpected errors', () => {
    const err = new Error('boom');
    const res = mockRes();
    errorHandler(err, mockReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'boom' }));
  });
});

describe('notFound', () => {
  it('returns 404 with route path', () => {
    const res = mockRes();
    notFound(mockReq({ originalUrl: '/api/v1/nope' }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('nope') }));
  });
});

describe('asyncHandler', () => {
  it('forwards rejected promises to next', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('rejected'));
    const next = jest.fn();
    const wrapped = asyncHandler(fn);
    await wrapped(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledWith(new Error('rejected'));
  });

  it('resolves successful handlers', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const next = jest.fn();
    const wrapped = asyncHandler(fn);
    await wrapped(mockReq(), mockRes(), next);
    expect(next).not.toHaveBeenCalled();
  });
});