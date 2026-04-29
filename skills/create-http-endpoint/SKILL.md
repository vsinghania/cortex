---
name: create-http-endpoint
description: Create or modify HTTP endpoints in the Cortex TypeScript backend. Use when adding Express routes/controllers under src/web-server, wiring validated request handlers with @validateRequest and Zod, preserving service-oriented boundaries, and routing errors through next(e).
---

# Create HTTP Endpoint

## Workflow

1. Inspect neighboring files before editing:
   - The target controller in `src/web-server/<feature>/`
   - The related service in `src/<feature>_svc/`
   - Existing schemas, types, repositories, and middleware used by that feature

2. Keep the boundary clean:
   - Put HTTP routing and response shaping in controllers.
   - Put business logic in services.
   - Use adapters/repositories when the feature already follows that pattern.
   - Keep imports in the repo's ESM `.js` style.

3. Add validation at untrusted boundaries:
   - Use `@validateRequest(...)` from `src/lib/decorators/validation_decorators.ts`.
   - Use Zod schemas for `body`, `query`, `params`, and `headers` as needed.
   - Define small local schemas near the controller unless the domain already has shared schemas/types.
   - After validation, cast `req.body`, `req.query`, or `req.params` to plain TypeScript types for internal use.

4. Follow the controller handler pattern:
   - Register the route in `registerRoutes()`.
   - Implement a private async method with `(req, res, next)`.
   - Wrap handler logic in `try/catch`.
   - Call services from inside the `try` block.
   - Return JSON as `{ response: result }` unless neighboring endpoints use a more specific shape.
   - In `catch`, call `next(e)` and let centralized error handling respond.

5. Verify the change:
   - Run the narrowest relevant test, typecheck, or lint command available in `package.json`.
   - If no focused command exists, run the lightest repo-level validation that is practical.

## Reference

Read `references/controller-pattern.md` when implementing or modifying an endpoint. It contains the Cortex controller template and checklist based on the existing auth/quiz controller style.
