/**
 * Authentication Middleware Tests
 * 
 * Tests for JWT authentication and rate limiting
 */

import { Request, Response, NextFunction } from 'express';
import { authenticateJWT, rateLimiter } from '../src/middleware/auth';
import jwt from 'jsonwebtoken';

describe('authenticateJWT', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      headers: {}
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    mockNext = jest.fn();
    
    process.env.JWT_SECRET = 'test-secret';
  });

  test('allows valid JWT token', () => {
    const token = jwt.sign(
      { userId: '123', email: 'test@example.com', role: 'user' },
      'test-secret'
    );
    
    mockReq.headers = {
      authorization: `Bearer ${token}`
    };

    authenticateJWT(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect((mockReq as any).user).toBeDefined();
    expect((mockReq as any).user.userId).toBe('123');
  });

  test('rejects missing authorization header', () => {
    authenticateJWT(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Missing authorization header'
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  test('rejects invalid token format', () => {
    mockReq.headers = {
      authorization: 'InvalidFormat'
    };

    authenticateJWT(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  test('rejects expired token', () => {
    const token = jwt.sign(
      { userId: '123', email: 'test@example.com', role: 'user' },
      'test-secret',
      { expiresIn: '-1h' }  // Expired 1 hour ago
    );
    
    mockReq.headers = {
      authorization: `Bearer ${token}`
    };

    authenticateJWT(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Token expired'
    });
  });

  test('rejects invalid token signature', () => {
    const token = jwt.sign(
      { userId: '123', email: 'test@example.com', role: 'user' },
      'wrong-secret'
    );
    
    mockReq.headers = {
      authorization: `Bearer ${token}`
    };

    authenticateJWT(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Invalid token'
    });
  });
});

describe('rateLimiter', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      ip: '127.0.0.1'
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    mockNext = jest.fn();
  });

  test('allows requests within limit', () => {
    const limiter = rateLimiter(5, 60000);

    for (let i = 0; i < 5; i++) {
      limiter(mockReq as Request, mockRes as Response, mockNext);
    }

    expect(mockNext).toHaveBeenCalledTimes(5);
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  test('blocks requests exceeding limit', () => {
    const limiter = rateLimiter(2, 60000);

    // First two should pass
    limiter(mockReq as Request, mockRes as Response, mockNext);
    limiter(mockReq as Request, mockRes as Response, mockNext);
    
    // Third should be blocked
    limiter(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(2);
    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Too many requests'
      })
    );
  });

  test('resets limit after time window', async () => {
    const limiter = rateLimiter(1, 100);  // 100ms window

    // First request
    limiter(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalledTimes(1);

    // Second request should be blocked
    limiter(mockReq as Request, mockRes as Response, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(429);

    // Wait for window to reset
    await new Promise(resolve => setTimeout(resolve, 150));

    // Should allow request again
    limiter(mockReq as Request, mockRes as Response, mockNext);
    expect(mockNext).toHaveBeenCalledTimes(2);
  });
});
