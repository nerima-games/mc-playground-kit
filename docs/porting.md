# Porting notes

## From local item identifiers to mc-kernel

HotbarSlot.item now has type mc-kernel.ItemType. Package consumers can import
the type and constructor through the kit root:

~~~ts
import { ItemType } from '@nerima-games/mc-playground-kit'

const slot = { item: ItemType('torch'), count: 1 }
~~~

Do not add a local string alias. The kernel registry is the source of truth.

## From delta submission to timestamps

PlaygroundHandle.submitFrame accepts MonotonicTimeSecs:

~~~ts
import { MonotonicTimeSecs } from '@nerima-games/mc-kernel'

yield* handle.submitFrame(MonotonicTimeSecs(performance.now() / 1000))
~~~

The caller must provide a non-decreasing monotonic clock. The loop derives
DeltaTimeSecs, applies its published clamp, and records dropped/clamped time.
Do not convert the timestamp to a delta in the caller.

## Browser runtimes

BrowserPreviewRuntime.frame still receives a DeltaTimeSecs, because the browser
boundary owns the timestamp source and mc-sim owns conversion. A runtime that
has no frame callback can omit it and still use the canvas and cleanup lifecycle.

## Package imports

The package root is an ESM export with declaration output:

~~~ts
import { makeBrowserPreview } from '@nerima-games/mc-playground-kit'
~~~

The root forwards the kernel public surface directly, so it does not create a
second brand or registry. Existing callers that already depend on mc-kernel
may continue importing its values from that package; do not recreate the
constructors locally.

## Ports

Existing callers should implement the four port services at their composition
root. The kit intentionally does not provide a fake renderer, input mapping, or
world generator as a production implementation. The terminal harness fakes the
ports only for deterministic lifecycle verification.

## Breaking-change policy

There are no compatibility aliases for the previous frame or item contracts.
Update callers at the boundary and let strict TypeScript checking find any
remaining old assumptions.
