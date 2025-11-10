# JWT Authentication Feature

This example demonstrates a successful agent output that added JWT authentication middleware with rate limiting.

## Changes Made

### Added Files
- `src/middleware/auth.ts` - Authentication middleware with JWT validation and rate limiting
- `tests/auth.test.ts` - Comprehensive tests for authentication flows

### Key Features
1. **JWT Token Validation**
   - Bearer token authentication
   - Token expiry handling
   - Invalid token detection
   - Proper error messages

2. **Rate Limiting**
   - IP-based request tracking
   - Configurable limits and windows
   - 429 status with retry-after header

3. **Error Handling**
   - Comprehensive try-catch blocks
   - Specific error types (TokenExpiredError, JsonWebTokenError)
   - User-friendly error messages
   - No sensitive information leakage

4. **Test Coverage**
   - Valid token acceptance
   - Missing/invalid token rejection
   - Expired token handling
   - Rate limit enforcement
   - Window reset behavior

## Suggested Evaluation Approach

For this type of authentication feature, a comprehensive evaluation suite should include:

1. **git-diff** - Track the scope of changes (files, lines)
2. **agentic-judge** - Evaluate:
   - JWT security best practices
   - Error handling completeness
   - Rate limiting implementation
   - Test coverage adequacy (target: ≥80%)
   - No hardcoded secrets

## Running Evaluation

Use `yb suggest-suite` to generate a customized evaluation suite:

```bash
yb suggest-suite --agent copilot-cli --output-dir ./examples/agent-outputs/auth-feature
```

The agent will analyze the changes and suggest appropriate evaluators with reasoning.
