# Design notes

## D1 — Kernel vocabulary has one owner

Coordinates, monotonic timestamps, delta times, stages, and item identifiers
come from mc-kernel. The kit does not define aliases such as a local ItemId,
constructors, or registries. Its root forwards the portable kernel surface
without taking ownership away from mc-kernel.

## D2 — Timing belongs to mc-sim

The playground submits monotonic timestamps to mc-sim.makeGameLoop. The
dependency owns first-frame behavior, clamping, queue capacity, interruption,
and counters. Maintaining a second local timestamp-to-delta implementation
would allow previews and the game to observe different timing.

## D3 — Ports are lifecycle boundaries

The kit's ports describe the small set of operations needed to start, advance,
observe, and stop a preview. They are not compatibility adapters and do not
reimplement upstream services. Concrete composition stays with the caller.

## D4 — Data and logic are separate

src/domain contains total functions and immutable values. src/application
contains Effects and mutable generation state. Browser APIs are confined to
browser-preview.ts.

## D5 — The kit does not compose modules

GameModule.layers and stage dependency resolution belong to the application
composition root. Runtime PreviewModule values carry only frameStages, in
declaration order.

## D6 — No legacy compatibility surface

The public frame contract is timestamp-based and item fields use
mc-kernel.ItemType. Old delta-based submission and local item-id names are
removed instead of maintained as aliases.

## D7 — Teardown is an operation, not a flag

Stopping first interrupts the active loop, waits for the current frame, then
releases dependent services. Every cleanup step is idempotent so abort, manual
stop, frame failure, and relaunch can converge on the same terminal state.

## Open implementation work

The official Minecraft feature set is larger than this lifecycle package.
Missing mechanics should be added to the relevant upstream domain package,
with tests and a concrete module/service contract. This repository should only
change when that work requires a new lifecycle boundary or preview integration.
