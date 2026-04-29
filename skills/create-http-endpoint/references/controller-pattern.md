# Cortex HTTP Endpoint Pattern

Use this pattern for Express controllers under `src/web-server/<feature>/`.

## Imports

```ts
import express from 'express';
import { z } from 'zod';
import { validateRequest } from '../../lib/decorators/validation_decorators.js';
import { FeatureSvc } from '../../feature_svc/feature_svc.js';
```

Use the relative path depth that matches the target file. Preserve the repo's `.js` import suffixes.

## Route Registration

Add the route in the controller's existing `registerRoutes()` method:

```ts
private registerRoutes() {
  this.router.post('/example', this.example.bind(this));
}
```

Include middleware in the route registration as and if needed:

```ts
this.router.get('/me', RequireAuthMiddleware.requireAuth, this.me.bind(this));
```

## Validated Handler Template

```ts
const ExampleRequestSchema = z.object({
  name: z.string().min(1)
});

type ExampleRequest = z.infer<typeof ExampleRequestSchema>;

@validateRequest({ body: ExampleRequestSchema })
private async example(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const body = req.body as ExampleRequest;
    const feature_svc = await FeatureSvc.create();
    const result = await feature_svc.example(body);

    res.status(200).json({ response: result });
  } catch (e) {
    next(e);
  }
}
```

Match local service construction:

- Use `await AuthSvc.create()` where the service exposes an async factory.
- Use `new QuizSvc()` where neighboring endpoints instantiate directly.
- Reuse existing request context helpers such as `AuthController.userAgent(req)` when the service expects request metadata.

## Validation Guidance

Use `@validateRequest` for every untrusted input surface:

```ts
@validateRequest({
  params: z.object({ id: z.string().uuid() }),
  query: z.object({ include_archived: z.string().optional() }),
  body: z.object({ title: z.string().min(1) })
})
```

The decorator validates but does not replace `req.body`, `req.query`, or `req.params` with parsed values. Cast after validation and do any type coercion explicitly in the controller or a schema helper already used by the repo.

## Error Handling

Do not send validation or service errors directly from the controller. Use this shape:

```ts
try {
  // handler logic
} catch (e) {
  next(e);
}
```

Let `src/common/middlewares/error_handler.ts` and existing domain errors control HTTP error responses.

## Response Shape

Default to:

```ts
res.status(200).json({ response: result });
```

Use `201` for successful creates. Preserve existing feature-specific response shapes, such as auth endpoints returning nested token fields and setting cookies.

## Checklist

- Route registered in `registerRoutes()`.
- Handler is private, async, bound in route registration, and accepts `req`, `res`, `next`.
- Zod validates all untrusted request data through `@validateRequest`.
- Controller only handles HTTP concerns, request shaping, service calls, and response shaping.
- Service/business logic stays outside `src/web-server`.
- Handler uses `try/catch` and `next(e)`.
- Imports use existing ESM `.js` style.
- Narrow validation or tests were run when practical.
