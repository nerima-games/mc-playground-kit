# API lock — @nerima-games/mc-playground-kit

<!-- ------------------------------------------------------------------------- -->
<!-- GENERATED FILE. Do not edit by hand.                                      -->
<!--                                                                           -->
<!-- Regenerate with `pnpm api:update`. `pnpm api:check`, which `pnpm verify`  -->
<!-- runs, fails when this file is stale.                                      -->
<!--                                                                           -->
<!-- Every line below is part of the published surface of this package. A diff -->
<!-- here is a diff in what consumers can see, and is the thing plan.md §6     -->
<!-- Step 0-3 asks to be reviewed as a diff. See scripts/api-lock.ts for how   -->
<!-- it is produced and why it is produced this way.                           -->
<!-- ------------------------------------------------------------------------- -->

format: 1
exported declarations: 44
supporting declarations: 23

## Exported

### BOOT_BUDGET_MILLIS  `const`

```ts
const BOOT_BUDGET_MILLIS: DurationMillis;
```

### BOOT_PHASE_BUDGET_MILLIS  `const`

```ts
const BOOT_PHASE_BUDGET_MILLIS: Readonly<Record<BootPhase, DurationMillis>>;
```

### BOOT_PHASE_ORDER  `const`

```ts
const BOOT_PHASE_ORDER: ReadonlyArray<BootPhase>;
```

### BootBudgetVerdict  `type`

```ts
type BootBudgetVerdict = {
    readonly withinBudget: boolean;
    readonly totalMillis: DurationMillis;
    readonly overBudgetMillis: DurationMillis;
    readonly missingPhases: ReadonlyArray<BootPhase>;
    readonly overrunPhases: ReadonlyArray<PhaseOverrun>;
};
```

### BootPhase  `type`

```ts
type BootPhase = 'resolve-options' | 'world' | 'simulation' | 'renderer' | 'input' | 'modules' | 'first-frame';
```

### DEFAULT_FLAT_WORLD  `const`

```ts
const DEFAULT_FLAT_WORLD: FlatWorldSpec;
```

### DEFAULT_SPAWN_KIT  `const`

```ts
const DEFAULT_SPAWN_KIT: SpawnKit;
```

### DurationMillis  `const`

```ts
const DurationMillis: Brand.Brand.Constructor<DurationMillis>;
```

### DurationMillis  `type`

```ts
type DurationMillis = number & Brand.Brand<'DurationMillis'>;
```

### FIRST_FRAME_DELTA_SECS  `const`

```ts
const FIRST_FRAME_DELTA_SECS: DeltaTimeSecs;
```

### FRAME_QUEUE_CAPACITY  `const`

```ts
const FRAME_QUEUE_CAPACITY = 60;
```

### FlatWorldSpec  `type`

```ts
type FlatWorldSpec = {
    readonly worldId: WorldId;
    readonly seed: number;
    readonly surfaceY: number;
    readonly radiusChunks: number;
};
```

### HotbarSlot  `type`

```ts
type HotbarSlot = {
    readonly item: ItemId;
    readonly count: number;
};
```

### InputPort  `class`

```ts
class InputPort extends InputPort_base {
}
```

### ItemId  `type`

```ts
type ItemId = string;
```

### LaunchOptions  `type`

```ts
type LaunchOptions = {
    readonly world?: Supplied<FlatWorldSpec> | undefined;
    readonly spawnKit?: Supplied<SpawnKit> | undefined;
    readonly modules?: ReadonlyArray<PreviewModule> | undefined;
};
```

### PhaseOverrun  `type`

```ts
type PhaseOverrun = {
    readonly phase: BootPhase;
    readonly durationMillis: DurationMillis;
    readonly budgetMillis: DurationMillis;
    readonly overByMillis: DurationMillis;
};
```

### PhaseTiming  `type`

```ts
type PhaseTiming = {
    readonly phase: BootPhase;
    readonly durationMillis: DurationMillis;
};
```

### Playground  `class`

```ts
class Playground extends Playground_base {
}
```

### PlaygroundApi  `type`

```ts
type PlaygroundApi = {
    readonly launch: (options?: LaunchOptions | undefined) => Effect.Effect<PlaygroundHandle, never, ClockPort | PlaygroundPorts>;
    readonly current: Effect.Effect<Option.Option<PlaygroundHandle>>;
    readonly stop: Effect.Effect<void>;
};
```

### PlaygroundHandle  `type`

```ts
type PlaygroundHandle = {
    readonly options: ResolvedLaunchOptions;
    readonly timings: ReadonlyArray<PhaseTiming>;
    readonly budget: BootBudgetVerdict;
    readonly stageOrderWarnings: ReadonlyArray<StageOrderViolation>;
    readonly submitFrame: (dt: DeltaTimeSecs) => Effect.Effect<void>;
    readonly framesRendered: Effect.Effect<number>;
    readonly cameraPose: Effect.Effect<CameraPoseSnapshot>;
    readonly isRunning: Effect.Effect<boolean>;
    readonly stop: Effect.Effect<void>;
};
```

### PlaygroundLayer  `const`

```ts
const PlaygroundLayer: Layer.Layer<Playground>;
```

### PlaygroundPorts  `type`

```ts
type PlaygroundPorts = WorldProviderPort | SimulationPort | RendererPort | InputPort;
```

### PreviewInputService  `type`

```ts
type PreviewInputService = {
    readonly attach: Effect.Effect<void>;
    readonly detach: Effect.Effect<void>;
};
```

### PreviewModule  `type`

```ts
type PreviewModule = Pick<GameModule<never, never, never>, 'frameStages'>;
```

### RendererPort  `class`

```ts
class RendererPort extends RendererPort_base {
}
```

### RendererService  `type`

```ts
type RendererService = {
    readonly attach: Effect.Effect<void>;
    readonly renderFrame: (dt: DeltaTimeSecs, pose: CameraPoseSnapshot) => Effect.Effect<void>;
    readonly detach: Effect.Effect<void>;
};
```

### ResolvedLaunchOptions  `type`

```ts
type ResolvedLaunchOptions = {
    readonly world: FlatWorldSpec;
    readonly spawnKit: SpawnKit;
    readonly modules: ReadonlyArray<PreviewModule>;
};
```

### SimulationPort  `class`

```ts
class SimulationPort extends SimulationPort_base {
}
```

### SimulationService  `type`

```ts
type SimulationService = {
    readonly spawn: (kit: SpawnKit) => Effect.Effect<void>;
    readonly tick: (dt: DeltaTimeSecs) => Effect.Effect<void>;
    readonly cameraPose: Effect.Effect<CameraPoseSnapshot>;
    readonly stop: Effect.Effect<void>;
};
```

### SpawnKit  `type`

```ts
type SpawnKit = {
    readonly feetPosition: Position;
    readonly yawRadians: number;
    readonly pitchRadians: number;
    readonly hotbar: ReadonlyArray<HotbarSlot>;
};
```

### StageOrderViolation  `type`

```ts
type StageOrderViolation = {
    readonly stage: StageId;
    readonly mustFollow: StageId;
    readonly declaredIndex: number;
    readonly constraintIndex: number;
};
```

### Supplied  `type`

```ts
type Supplied<T> = {
    readonly [K in keyof T]?: T[K] | undefined;
};
```

### WorldProviderPort  `class`

```ts
class WorldProviderPort extends WorldProviderPort_base {
}
```

### WorldProviderService  `type`

```ts
type WorldProviderService = {
    readonly openFlatWorld: (spec: FlatWorldSpec) => Effect.Effect<void>;
    readonly closeWorld: Effect.Effect<void>;
};
```

### classifyBootTimings  `const`

```ts
const classifyBootTimings: (timings: ReadonlyArray<PhaseTiming>) => BootBudgetVerdict;
```

### describeBootVerdict  `const`

```ts
const describeBootVerdict: (verdict: BootBudgetVerdict) => string;
```

### elapsedMillis  `const`

```ts
const elapsedMillis: (fromSecs: number, toSecs: number) => DurationMillis;
```

### flattenStages  `const`

```ts
const flattenStages: (modules: ReadonlyArray<PreviewModule>) => Effect.Effect<ReadonlyArray<StageRegistration>>;
```

### flattenedStageOrderViolations  `const`

```ts
const flattenedStageOrderViolations: (stages: ReadonlyArray<StageRegistration>) => ReadonlyArray<StageOrderViolation>;
```

### launchPlayground  `const`

```ts
const launchPlayground: (options?: LaunchOptions | undefined) => Effect.Effect<PlaygroundHandle, never, Playground | ClockPort | PlaygroundPorts>;
```

### makePlayground  `const`

```ts
const makePlayground: Effect.Effect<PlaygroundApi>;
```

### normalizeLaunchOptions  `const`

```ts
const normalizeLaunchOptions: (options?: LaunchOptions | undefined) => ResolvedLaunchOptions;
```

### stageOrderViolations  `const`

```ts
const stageOrderViolations: (modules: ReadonlyArray<PreviewModule>) => Effect.Effect<ReadonlyArray<StageOrderViolation>>;
```

## Supporting declarations

Not exported from the barrel, but named by the signatures above, so a
consumer is exposed to them. `Context.Tag` service classes emit their real
type onto one of these.

### CameraPoseSnapshot  `type`

```ts
type CameraPoseSnapshot = {
    readonly position: Position;
    readonly yawRadians: number;
    readonly pitchRadians: number;
    readonly capturedAtSecs: MonotonicTimeSecs;
};
```

### ClockPort  `class`

```ts
class ClockPort extends ClockPort_base {
}
```

### ClockPort_base  `const`

```ts
const ClockPort_base: Context.TagClass<ClockPort, "@nerima-games/mc-kernel/ClockPort", ClockService>;
```

### ClockService  `type`

```ts
type ClockService = {
    readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>;
    readonly wallClockEpochMillis: Effect.Effect<EpochMillis>;
};
```

### DeltaTimeSecs  `const`

```ts
const DeltaTimeSecs: Brand.Brand.Constructor<DeltaTimeSecs>;
```

### DeltaTimeSecs  `type`

```ts
type DeltaTimeSecs = number & Brand.Brand<'DeltaTimeSecs'>;
```

### EpochMillis  `const`

```ts
const EpochMillis: Brand.Brand.Constructor<EpochMillis>;
```

### EpochMillis  `type`

```ts
type EpochMillis = number & Brand.Brand<'EpochMillis'>;
```

### FrameServices  `type`

```ts
type FrameServices = ClockPort;
```

### GameModule  `interface`

```ts
interface GameModule<ROut, E, RIn, RRegister = never> {
    readonly layers: Layer.Layer<ROut, E, RIn>;
    readonly frameStages: Effect.Effect<ReadonlyArray<StageRegistration>, never, RRegister>;
}
```

### InputPort_base  `const`

```ts
const InputPort_base: Context.TagClass<InputPort, "@nerima-games/mc-playground-kit/InputPort", PreviewInputService>;
```

### MonotonicTimeSecs  `const`

```ts
const MonotonicTimeSecs: Brand.Brand.Constructor<MonotonicTimeSecs>;
```

### MonotonicTimeSecs  `type`

```ts
type MonotonicTimeSecs = number & Brand.Brand<'MonotonicTimeSecs'>;
```

### Playground_base  `const`

```ts
const Playground_base: Context.TagClass<Playground, "@nerima-games/mc-playground-kit/Playground", PlaygroundApi>;
```

### Position  `type`

```ts
type Position = {
    readonly x: number;
    readonly y: number;
    readonly z: number;
};
```

### RendererPort_base  `const`

```ts
const RendererPort_base: Context.TagClass<RendererPort, "@nerima-games/mc-playground-kit/RendererPort", RendererService>;
```

### SimulationPort_base  `const`

```ts
const SimulationPort_base: Context.TagClass<SimulationPort, "@nerima-games/mc-playground-kit/SimulationPort", SimulationService>;
```

### StageId  `const`

```ts
const StageId: Brand.Brand.Constructor<StageId>;
```

### StageId  `type`

```ts
type StageId = string & Brand.Brand<'StageId'>;
```

### StageRegistration  `interface`

```ts
interface StageRegistration {
    readonly id: StageId;
    readonly after?: ReadonlyArray<StageId>;
    readonly run: (dt: DeltaTimeSecs) => Effect.Effect<void, never, FrameServices>;
}
```

### WorldId  `const`

```ts
const WorldId: Brand.Brand.Constructor<WorldId>;
```

### WorldId  `type`

```ts
type WorldId = string & Brand.Brand<'WorldId'>;
```

### WorldProviderPort_base  `const`

```ts
const WorldProviderPort_base: Context.TagClass<WorldProviderPort, "@nerima-games/mc-playground-kit/WorldProviderPort", WorldProviderService>;
```
