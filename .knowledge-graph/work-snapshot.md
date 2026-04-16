# Upstream Upgrade Snapshot

## Latest status
- Current repo upstream version: 2.1.109
- Last attempted target: 2.1.110
- Last result: broken
- Last timestamp: 2026-04-16T01:51:22.577Z

## Recent attempts
- 2.1.109 -> 2.1.110: broken (08-model-family, 14b-agent-prompt-hide-email, 13h-mascot-apple-left, 13i-mascot-apple-face, 13j-mascot-apple-right, 13k-mascot-apple-body, 13l-mascot-apple-feet, 60-model-display-name, 67-public-model-display, 66-fast-mode-display, 20-tier-bypass, 21-subscriber-bypass, 22-loop-dynamic-enable, 24-loop-prompt-enable, 23-no-defer-third-party, 25-sonnet-default)

## Known fragile areas
- 08-model-family (1 recent failures)
- 14b-agent-prompt-hide-email (1 recent failures)
- 13h-mascot-apple-left (1 recent failures)

## Recommended next recovery step
- Inspect the repeated failing patch modules first
- Compare the newest varmap against the previous released version
