## Brief overview
Project-specific guidelines for a TypeScript-based web application with AI services, following a clean architecture pattern with services, controllers, adapters, and repositories.

## Project architecture
- Use service layer pattern: separate services (ai_svc, agent_svc) from web controllers
- Implement adapter pattern for external integrations (OpenAI, GenAI adapters in ai_svc/adapters/)
- Place web server controllers in web-server/ directory, organized by feature (ai/, agent/, user/)
- Keep common utilities in common/ directory (errors, logger, middlewares)
- Use repository pattern for data access when applicable

## Coding conventions
- Function names: camelCase
- Variable names: snake_case
- Indentation: 2 spaces
- File naming:
  - Base names: snake_case for TypeScript files
  - Type definitions: xyz.types.ts (e.g., user.types.ts, ai_prompt.types.ts)
  - Controllers: xyz.controller.ts (e.g., auth.controller.ts, agent.controller.ts)
- Avoid excessive comments in code
- Units in numeric constants: when a number represents a quantity with units (duration, size, distance), make the unit explicit — either in the variable/constant name (e.g. `REFRESH_INTERVAL_MS`) or via a conversion helper that names both sides (e.g. `Duration.minutesToMs(10)`). Avoid ambiguous helpers like `Duration.minutes(10)` where the return unit isn't obvious from the call site.
- Extract complex logic into named functions: when a piece of logic is non-trivial — multi-step calculations, unit conversions, conditional chains, or any expression whose intent isn't obvious at a glance — pull it into a well-named method/function rather than leaving it inline. The function name should communicate intent so the call site reads clearly (e.g. prefer `Duration.minutesToMs(10)` over `10 * 60 * 1000`, prefer `isEligibleForRefresh(agent)` over an inline boolean expression). Applies to both shared helpers in `lib/` and private methods within a class.
- Prefer small classes and small methods/functions that each have a single responsibility.
- Keep method/function parameter lists short; group related inputs into typed objects when it improves readability.
- No free/global functions: define all functions inside classes. Public or static methods are allowed; do not export standalone functions to avoid namespace pollution.
- Allowed exceptions (narrow):
  - Decorators in lib/decorators/** are permitted to expose decorator factories as top-level functions if required by decorator syntax.
  - Scripts in scripts/** may use top-level functions for CLI/bootstrap convenience.
- Wrap third-party utility packages behind a `lib/` class. Do not import packages like `nanoid`, date/uuid/crypto-style helpers, etc. directly from feature code. Add a thin static-class wrapper in `src/lib/` (examples: `Time` for duration math, `Id` for nanoid) and import the wrapper. This keeps the dependency in one place — easier to swap, mock, or add cross-cutting concerns. Framework SDKs (express, mongoose, pino, zod, openai, etc.) are exempt.

## TypeScript patterns
- Encapsulate behavior in classes: all functions should be class methods (instance or static). Do not export free/global functions except in the allowed exceptions above.
- Prefer factory methods for object creation whenever practical, especially for classes that require async initialization or setup. Keep constructors private or minimal where a `static create(...)` method can centralize setup and prevent partially initialized instances.
- Avoid `any` and `unknown` unless necessary; prefer specific types, interfaces, or validated schemas.
- Define types in dedicated types/ subdirectories within each module
- Use interfaces for service contracts (e.g., agent_interface.ts, ai_svc_interface.ts)
- Keep models in separate models/ subdirectories when needed

## Middleware and error handling
- Centralize error handling in common/middlewares/error_handler.ts
- Implement logging decorators in lib/decorators/logging_decorators.ts
- Use validation decorators in lib/decorators/validation_decorators.ts

## Project organization
- Group related functionality by domain/feature (agent/, ai_svc/, user/)
- Keep infrastructure code (logger, validator, decorators) in lib/ directory
- Separate web-server concerns from business logic

## Validation: Zod vs TypeScript (concise)
- Use Zod at untrusted boundaries only:
  - HTTP body/query/params (middleware)
  - External responses (LLMs, webhooks, 3rd-party APIs)
  - Env/config at startup
- Use plain TS types for internal domain/services after validation.

## Git and commit conventions
- Single-line commit messages only. Do not include a body or additional lines.
- Keep the subject concise (ideally ≤ 72 characters), present-tense, imperative mood.
- Prefer a short scope when helpful: type(scope): summary
- Allowed types: feat, fix, refactor, docs, test, chore, build, ci, perf, revert.
