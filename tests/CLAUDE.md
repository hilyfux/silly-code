# tests/ — Test Suite
## Prohibitions
- Mocking provider configs in schema tests → use real configs to catch actual validation errors
## When Changing
- _base.cjs protocol functions → update base.test.cjs
- Provider schema/validation → update schema.test.cjs
## Conventions
- base.test.cjs = _base.cjs unit tests (mapModel, msgToOai, msgsToResponsesInput)
- schema.test.cjs = provider schema validation + engine load test
- Run with: node tests/base.test.cjs && node tests/schema.test.cjs
- No test framework — plain Node assert-style with PASS/FAIL output
