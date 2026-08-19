# Preview harness

This directory contains a deterministic terminal preview for exercising the
playground lifecycle without a browser or WebGL.

## Run

~~~sh
nix develop
pnpm preview
~~~

The command runs apps/preview-harness/harness.ts through tsx. It supplies fake
world, simulation, renderer, and input ports, submits timestamped frames, and
prints boot and teardown observations.

## What it verifies

- default option normalization;
- the boot phase order and budget result;
- mc-sim frame submission through the public handle;
- relaunch and generation isolation;
- idempotent shutdown.

The harness is a diagnostic consumer of the public API. It is not a renderer
and is not evidence of official Minecraft gameplay parity.

## Source

- harness.ts: Effect program and fake service layers.
- probes.ts: small observable fakes used by the program.

Run the repository test and coverage commands for acceptance checks; this
terminal output is intended for interactive inspection.
