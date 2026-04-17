# tests/ — Test Suite
## Prohibitions
- Mocking provider configs in schema tests → use real configs to catch actual validation errors
- Real network / real creds in providers.test.cjs → sandbox must be hermetic
## When Changing
- _base.cjs protocol functions → update base.test.cjs
- Provider schema/validation → update schema.test.cjs
- openai.cjs adapter glue → update providers.test.cjs (+ fixtures if new shape)
- MATCH constants / sentinel injection / checkSerialization → update build-integrity.test.cjs
## Conventions
- base.test.cjs — _base.cjs unit tests (mapModel, msgToOai, msgsToResponsesInput, SSE streams)
- schema.test.cjs — provider schema validation + engine load
- providers.test.cjs — end-to-end adapter tests in a mocked sandbox (fetch stubbed, auth stubbed, _base injected)
- build-integrity.test.cjs — build-time guarantees (checkSerialization, sentinel injection, detection chain, anchor guards)
- fixtures/ — canonical Anthropic-format request bodies used by providers.test.cjs
- Run with: npm test
- No test framework — plain Node assert-style with PASS/FAIL output
