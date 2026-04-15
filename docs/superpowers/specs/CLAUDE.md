# specs — Architecture Design Documents
## Prohibitions
- Writing specs without current-state evidence → aspirational claims drift from reality
- Deleting superseded specs → mark "IMPLEMENTED" or "SUPERSEDED", keep for history
## When Changing
- System blueprint → verify against pipeline/patches/ actual code
- Roadmap status → confirm with git log before marking done
## Conventions
- One spec per design decision or major feature
- Filename: YYYY-MM-DD-<topic>-design.md
- Living docs updated in-place; historical specs marked with status header
