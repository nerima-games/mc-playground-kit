---
"@nerima-games/mc-playground-kit": minor
---

Public duration, fluid, and redstone constructors now return tagged `Valid` or `Invalid` results instead of throwing for rejected values. Boot timing classification also returns a typed failure when valid phase durations overflow during aggregation, and the application propagates that failure through Effect.
