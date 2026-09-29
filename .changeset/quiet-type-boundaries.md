---
"@nerima-games/mc-playground-kit": minor
---

Add the public `FlatWorldSpecInput` and `StatusEffectStateInput` boundary types
so callers can pass configuration or persisted status data before validation.
Invalid world specs now produce `InvalidWorldSpecError`, and unknown status
effect types produce a named `TypeError` instead of an indirect undefined
property exception.
