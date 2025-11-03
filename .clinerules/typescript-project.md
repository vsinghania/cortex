## Brief overview
Project-specific guidelines for a TypeScript-based web application with AI/quiz services, following a clean architecture pattern with services, controllers, adapters, and repositories.

## Project architecture
- Use service layer pattern: separate services (ai_svc, quiz_svc) from web controllers
- Implement adapter pattern for external integrations (OpenAI, GenAI adapters in ai_svc/adapters/)
- Place web server controllers in web-server/ directory, organized by feature (ai/, quiz/, user/)
- Keep common utilities in common/ directory (errors, logger, middlewares)
- Use repository pattern for data access when applicable

## Coding conventions
- Function names: camelCase
- Variable names: snake_case
- Indentation: 2 spaces
- File naming:
  - Base names: snake_case for TypeScript files
  - Type definitions: xyz.types.ts (e.g., user.types.ts, ai_prompt.types.ts)
  - Controllers: xyz.controller.ts (e.g., auth.controller.ts, quiz.controller.ts)
- Avoid excessive comments in code
- No free/global functions: define all functions inside classes. Public or static methods are allowed; do not export standalone functions to avoid namespace pollution. Only make exceptions when absolutely required, and document the rationale inline.

## TypeScript patterns
- Encapsulate behavior in classes: all functions should be class methods (instance or static). Do not export free/global functions.
- Exceptions: only when absolutely required (e.g., framework bootstrap).
- Define types in dedicated types/ subdirectories within each module
- Use interfaces for service contracts (e.g., agent_interface.ts, ai_svc_interface.ts)
- Keep models in separate models/ subdirectories when needed

## Middleware and error handling
- Centralize error handling in common/middlewares/error_handler.ts
- Implement logging decorators in lib/decorators/logging_decorators.ts
- Use validation decorators in lib/decorators/validation_decorators.ts

## Project organization
- Group related functionality by domain/feature (agent/, ai_svc/, quiz_svc/, user/)
- Keep infrastructure code (logger, validator, decorators) in lib/ directory
- Separate web-server concerns from business logic

## Validation: Zod vs TypeScript (concise)
- Use Zod at untrusted boundaries only:
  - HTTP body/query/params (middleware)
  - External responses (LLMs, webhooks, 3rd-party APIs)
  - Env/config at startup
- Use plain TS types for internal domain/services after validation.
