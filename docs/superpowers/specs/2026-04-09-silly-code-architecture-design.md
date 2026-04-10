# Silly Code architecture convergence design

## Goal

Evolve Silly Code from a successful multi-source fork into a maintainable multi-provider product with clear subsystem boundaries, predictable extension points, and lower regression risk.

This design intentionally prioritizes architectural convergence over shipping more surface-area features first. The current project already has strong functionality and differentiated positioning; the highest-leverage next step is reducing structural complexity so future feature work, upstream intake, and bugfixes become cheaper and safer.

## Context

Current positioning in `README.md` is clear: Silly Code is a multi-provider coding assistant built on Claude Code with ideas and fixes merged from community forks. The codebase already supports three provider backends and preserves advanced Claude Code capabilities.

Three signals indicate that the next step should be structural rather than purely additive:

1. `src/entrypoints/cli.tsx` has accumulated many fast paths and bootstrap responsibilities.
2. `src/commands.ts` has become a very large registry and orchestration file for built-in commands, dynamic skills, plugin skills, gated commands, and availability filtering.
3. Existing CLAUDE guidance in `src/services/api/CLAUDE.md`, `src/services/oauth/CLAUDE.md`, and `src/utils/model/CLAUDE.md` captures non-obvious provider invariants, which means the provider architecture already has hidden contracts that should be made explicit in code.

## Non-goals

This phase does not aim to:

- add broad new user-facing feature families
- redesign the terminal UI
- replace the current skill/plugin model
- rework unrelated subsystems that are not blocking maintainability
- chase full test coverage across the whole repository

## Design principles

### 1. Provider-specific behavior must stay inside provider boundaries

Differences between Claude, Codex, and Copilot should live in provider-specific descriptors, auth logic, token management, fetch adaptation, and model mapping. Query execution, command handling, and user-facing orchestration should consume provider capabilities through stable contracts rather than branching on provider details repeatedly.

### 2. Registration and orchestration should be separated

The project should avoid files that both define concrete commands and act as the central policy engine for how all commands are loaded, filtered, and ordered.

### 3. Upstream/community intake must become systematic

Changes from upstream Claude Code, free-code, cc-haha, and the local Claude Code reference should be translated into local abstractions instead of merged as isolated patches wherever convenient.

### 4. Verify the most important seams first

The first round of tests should target architectural seams that, if broken, invalidate a large amount of user-visible functionality: provider login, token refresh, client construction, model/provider routing, command availability, and bootstrap fast paths.

## Proposed architecture

The codebase should be treated as four primary planes.

### Plane 1: Provider plane

Responsibilities:

- provider identity (`ProviderId`)
- provider capabilities and availability
- auth/token lifecycle
- fetch adapter construction
- model mapping

Suggested contracts:

- `ProviderId`
- `ProviderDescriptor`
- `ProviderCapabilities`
- `ProviderAuthClient`
- `ProviderTokenStore`
- `ProviderFetchAdapterFactory`
- `ProviderModelMap`

This plane absorbs differences like OAuth flow shape, token exchange requirements, refresh semantics, placeholder API keys, and backend-specific model names.

### Plane 2: Command plane

Responsibilities:

- define built-in commands
- apply feature gates
- apply provider/auth availability rules
- merge commands from built-in, plugin, workflow, skill, and dynamic sources
- expose a consistent final command list to the REPL/runtime

This plane should distinguish between:

- command definitions
- command sources
- command filters/policies
- command assembly order

### Plane 3: Agent/skill plane

Responsibilities:

- bundled skill loading
- plugin-provided skills
- dynamic skill discovery
- agent command exposure
- MCP skill integration

This plane should remain conceptually separate from command assembly, even if the final output is a shared command list.

### Plane 4: Runtime plane

Responsibilities:

- CLI bootstrap and fast paths
- config initialization
- REPL startup
- QueryEngine orchestration
- state/tasks/hooks/background work

The runtime plane should depend on stable provider and command interfaces, not on internal details of each provider implementation.

## Key changes by subsystem

### A. Provider core convergence

#### Problem

Provider logic is currently spread across constants, OAuth handling, API client construction, and model configuration. The CLAUDE docs show these pieces already depend on each other in non-obvious ways. That makes extending or fixing provider support easy to get wrong.

#### Design

Introduce an explicit provider registry module that describes each supported provider in one place. Each provider entry should declare:

- provider id
- display name
- auth strategy
- token source/refresh behavior
- fetch adapter factory
- model mapping source
- capabilities used by higher layers

The rest of the system should ask the registry for provider behavior rather than hard-coding provider branches across multiple files.

#### Expected impact

- fewer synchronized edits across multiple directories
- lower chance of drift between OAuth, API client creation, and model config
- easier future support for provider-specific capability checks

### B. Command assembly convergence

#### Problem

`src/commands.ts` currently acts as both a source-of-truth registry and a large orchestration file. This increases cognitive load and makes it hard to reason about what is a command definition versus what is command-loading policy.

#### Design

Split the responsibilities into composable layers:

1. built-in command definitions
2. feature-gated built-in command definitions
3. external command sources (skills, plugins, workflows, MCP)
4. availability policy filtering
5. final merge/order pipeline

`getCommands()` should become a thin orchestration function over these layers.

#### Expected impact

- command additions become more local and less risky
- availability logic becomes easier to test in isolation
- dynamic skill/plugin loading becomes easier to observe and debug

### C. Unified provider-facing UX

#### Problem

The product is positioned as one assistant with three backends, but internal evolution still reflects a first-party Anthropic origin. That creates a risk that login, status, model listing, and failure messaging feel uneven across providers.

#### Design

Standardize provider-facing flows around a shared UX contract for:

- login
- logout
- status
- model listing
- provider selection/switching
- auth failure recovery messages

Shared command logic should render provider-aware messages from provider descriptors/capabilities instead of embedding provider-specific copy in scattered places.

#### Expected impact

- more coherent product feel
- fewer provider-specific edge cases in user-visible flows
- easier addition of provider-specific onboarding later without branching everywhere

### D. Runtime bootstrap simplification

#### Problem

`src/entrypoints/cli.tsx` is carrying many fast paths for specialized modes and background functionality. The file is still workable, but its trajectory suggests continued growth and tighter coupling to more subsystems.

#### Design

Refactor bootstrap into three conceptual stages:

1. argument/fast-path discrimination
2. environment/config/auth preparation
3. handoff to specific runtime or subcommand main

The entrypoint should mainly route; specialized branches should live in focused modules.

#### Expected impact

- lower entrypoint churn
- easier smoke testing of fast-path routing
- simpler reasoning about startup regressions

### E. Upstream intake workflow

#### Problem

The project benefits from multiple upstreams and forks, but without a repeatable intake method future merges will increase inconsistency.

#### Design

Define a lightweight upstream intake workflow:

1. classify candidate change: bugfix, provider support, UX, infra, or experimental feature
2. map it to the local target plane
3. adapt it to local abstractions instead of copying shape blindly
4. add or update focused verification around the seam it touches

This workflow belongs in contributor practice and future planning, not necessarily in user-facing docs.

#### Expected impact

- better long-term coherence
- less patch archaeology later
- easier reasoning about why certain upstream ideas were adapted, not copied verbatim

## Data flow

### Provider-backed request flow

1. User starts CLI or REPL.
2. Runtime resolves config and selected model.
3. Model selection resolves to a provider via provider/model mapping.
4. Provider registry returns the relevant auth/token/fetch behavior.
5. API client is constructed through provider-specific adapter creation.
6. QueryEngine executes against a provider-neutral client contract.
7. Result handling continues through shared agent/tool/UI logic.

The crucial design constraint is that QueryEngine and the command plane should not need to understand Copilot-vs-Codex token semantics.

## Error handling model

Error handling should stay explicit and boundary-based.

### Auth errors

Return provider-aware recovery guidance such as re-login or missing subscription, sourced from provider metadata and auth results.

### Capability mismatch

If a command, model, or feature is unavailable for a provider, fail with a provider-aware capability message rather than an opaque generic error.

### Bootstrap errors

Fast-path and mode-routing failures should fail early with minimal side effects.

### Plugin/skill load failures

Continue running when possible, but log and surface enough information to debug loading failures without breaking the rest of the session.

## Testing strategy

The first round of tests should target high-value seams rather than chasing total coverage.

### Priority 1

- provider client construction contract tests
- OAuth/token lifecycle tests
- model-to-provider routing tests
- command availability/filter tests

### Priority 2

- command registry smoke/snapshot tests
- dynamic skill/plugin loading tests
- login/status/models CLI smoke tests

### Priority 3

- selected entrypoint fast-path smoke tests for key modes

## Recommended execution order

1. Define provider contracts and registry shape.
2. Refactor API/OAuth/model layers to consume the provider registry.
3. Split command definitions from command assembly/orchestration.
4. Normalize login/status/models provider UX on top of shared provider metadata.
5. Add seam-focused tests for provider and command pipelines.
6. Use the new structure to absorb additional upstream/community improvements.

## Trade-off analysis

### Approach 1: keep shipping features on current structure

Pros:
- fastest short-term output
- lowest immediate refactor cost

Cons:
- complexity continues to accumulate
- every provider or command change remains more fragile than necessary
- upstream intake gets harder over time

### Approach 2: broad cleanup/refactor first

Pros:
- can produce a cleaner architecture on paper

Cons:
- high risk of oversized diff
- likely to disrupt working features and slow delivery
- too much unrelated movement at once

### Approach 3: convergence around core seams first

Pros:
- targets the highest-leverage structural pain
- keeps scope narrow enough for phased delivery
- directly improves future feature velocity and mergeability

Cons:
- some architectural debt remains outside the chosen seams for now
- user-visible benefits are more medium-term than flashy

Recommended approach: Approach 3.

## Success criteria

This design is successful when:

- provider changes require fewer synchronized edits across distant modules
- command assembly logic is easier to trace and test than it is today
- provider-facing commands feel like one coherent product surface
- entrypoint routing is simpler to extend without growing one central file indefinitely
- future upstream/community changes have clear landing zones
- critical provider and command seams have smoke or contract coverage

## First implementation slice

The first implementation slice should focus on the provider plane and command assembly plane, because these are the most leveraged foundations for the rest of the system. That slice should avoid broad UI changes and instead build contracts, refactor current integrations onto them, and add tests that prove the new boundaries hold.
