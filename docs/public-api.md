# 公開API

plan.md §3.10 は主要な公開APIを 1 行だけ書いている。

> `launchPlayground(options: {world?, spawnKit?, modules?}) → 起動済みミニゲーム`

本書はそれを実際の型まで展開したもの。**参照実装に対応物がある箇所は実コードと突き合わせ、
無い箇所は「無い」と明記する。** plan.md §3.10 の移植元は「なし（新規）」なので、
後者のほうが多い（[porting.md](./porting.md)）。

パスはすべて `takeokunn/ts-minecraft` リポジトリルート相対。

## 0. サービス定義方式

参照実装は `Effect.Service` クラスを使う（`packages/entity/application/player-service.ts:8-11`）。
**新実装は `Context.Tag` + 明示的な `Layer` を採る**。mc-sim と同じ判断であり
（`mc-sim/docs/public-api.md` §0）、kit ではさらに 2 つ理由が重い。

- **テスト差し替えが `Layer.succeed(Tag, fake)` だけで済む。** 本リポジトリの Port は 4 つとも
  未公開リポジトリの surface なので、**現時点では全テストが fake で走っている**。
  継承やキャストが要る方式だとテストが書けない。
- **同じ Tag で複数インスタンスを作れる。** plan.md §3.8 の「再入可能な初期化」に効く。
  プレビューを 2 枚並べることは、ハーネスにとって普通の要求である。

Tag の文字列は `@nerima-games/mc-playground-kit/Xxx` に統一する
（ミラーである `ClockPort` だけは `@nerima-games/mc-kernel/ClockPort`。
kernel 公開時にそのまま置き換わる必要があるため）。

## 1. `launchPlayground` — plan.md §3.10 の入口

```typescript
export const launchPlayground = (
  options?: LaunchOptions | undefined,
) => Effect.Effect<PlaygroundHandle, never, Playground | ClockPort | PlaygroundPorts>
```

### 1.1 なぜ `Playground` を要求するのか

plan.md の記述は自由関数に見える。実際にはサービス経由にしてある。

**理由は「2 回目の起動」である。** 自由関数は、自分が知らない過去の起動を後始末できない。
plan.md §3.8 が参照実装の最大級のバグ源として挙げるのが 2 周目ワールドの
デッドロック / やり残し fiber であり、ハーネスはそれを**毎回のホットリロードでやる**道具である。
「前回のプレビュー」の置き場所が要る。

```typescript
export type PlaygroundApi = {
  readonly launch: (options?: LaunchOptions | undefined)
    => Effect.Effect<PlaygroundHandle, never, ClockPort | PlaygroundPorts>
  readonly current: Effect.Effect<Option.Option<PlaygroundHandle>>
  readonly stop: Effect.Effect<void>
}

export class Playground extends Context.Tag('@nerima-games/mc-playground-kit/Playground')<
  Playground, PlaygroundApi
>() {}

export const makePlayground: Effect.Effect<PlaygroundApi>
export const PlaygroundLayer: Layer.Layer<Playground>
```

`makePlayground` も公開しているのは、plan.md §3.8 の DN-09 の答えが
「そもそもシングルトンにしない」だからである（`mc-sim/docs/design-notes.md` DN-09）。
`Layer.effect` なので **Layer を 2 回 build すれば独立したハーネスが 2 つ**得られる。

### 1.2 エラーチャネルが `never` である理由

起動が失敗しないわけではない。**失敗はすべて Port の向こう側にある**からである。
ワールド生成に失敗するのは mc-worldgen、レンダラの attach に失敗するのは mc-render であり、
それぞれの失敗型はそれぞれが決める。ハーネスがここで独自のエラー型を被せると、
呼び出し側は「kit のエラー」を剥がして中身を見る作業をすることになる。

現在の Port はすべて `Effect<void>`（失敗なし）で宣言してある。実装が付いた時点で
`E` を持つ Port が出てきたら、`launchPlayground` の `E` はその和になる。
**その変更は破壊的変更として扱う**（[versioning.md](./versioning.md)）。

## 2. `LaunchOptions` — 本リポジトリで最も重要な型

```typescript
export type Supplied<T> = { readonly [K in keyof T]?: T[K] | undefined }

export type LaunchOptions = {
  readonly world?: Supplied<FlatWorldSpec> | undefined
  readonly spawnKit?: Supplied<SpawnKit> | undefined
  readonly modules?: ReadonlyArray<PreviewModule> | undefined
}

export type ResolvedLaunchOptions = {
  readonly world: FlatWorldSpec
  readonly spawnKit: SpawnKit
  readonly modules: ReadonlyArray<PreviewModule>
}

export const normalizeLaunchOptions:
  (options?: LaunchOptions | undefined) => ResolvedLaunchOptions
```

### 2.1 契約: 無引数で完結する

**`launchPlayground()` を引数ゼロで呼んだら、立って歩けるワールドが出る。**

これが成立しないと、15 リポジトリのプレビューそれぞれが定型文を持ち、
その定型文がリポジトリごとに drift する。plan.md §3.10 が全フィールドを `?` にしているのは
そういう意味だと解釈した。`test/launch-options.test.ts` の
`launchPlayground() with NO options is a complete configuration` がこれを固定している。

### 2.2 入口は寛容、出口は全域

`tsconfig.base.json` は `exactOptionalPropertyTypes: true`。この設定下では `x?: T` は
「省略可」だが「明示的な `undefined` は不可」になる。プログラムが**組み立てる**値には正しく、
呼び出し側が**書く**値には間違っている。

```typescript
launchPlayground({ world: featureFlag ? { seed: 7 } : undefined })
```

これは普通の呼び出しコードであり、`world?: Supplied<FlatWorldSpec>` ではコンパイルが通らない。
したがって**入口の任意フィールドはすべて `?: T | undefined`**、**出口は全フィールド必須**。
寛容さはこの関数で止まる。以降のコードは二度と「供給されたか」を問わない。

`test/launch-options.test.ts` の
`an explicit undefined FIELD means "not supplied", not "blank it out"` は
**コンパイルできること自体がアサーション**である。

### 2.3 既定値のマージはフィールド単位

`{ ...DEFAULT, ...override }` は使わない。`override` が明示的な `undefined` を運びうる
（§2.2 でそれを合法にした）ので、オブジェクトマージだと既定値が消える。

`pick(supplied, fallback)` は `supplied === undefined` だけを見る。
`??` でも `||` でもないのは、**`0` と `[]` が正当な指定値だから**である。
`radiusChunks: 0`（1 チャンクだけ）も `hotbar: []`（手ぶらで始めたい）も実在する要求で、
truthiness 判定はそれを黙って既定値に戻してしまう。

### 2.4 `world` — ミニ平地ワールド

```typescript
export type FlatWorldSpec = {
  readonly worldId: WorldId       // 既定 'playground'
  readonly seed: number           // 既定 0（固定）
  readonly surfaceY: number       // 既定 49
  readonly radiusChunks: number   // 既定 1（3x3 = 48x48 ブロック）
}
```

| フィールド | 既定値の根拠 |
| --- | --- |
| `seed` | **固定**。毎回違う地形が出るプレビューはスクリーンショット比較ができない。plan.md §3.10 の完了条件が「起動→操作→スクリーンショット」である以上、決定論は要件 |
| `surfaceY` | 49。**海面とは無関係な、単なる平地の高さである**（下記の訂正を参照） |
| `radiusChunks` | 1。3x3 チャンク = 48x48 ブロック。1 分歩いてもチャンクストリーミングで止まらず、かつ `world` phase のバジェット 400ms に収まる大きさ |

#### 訂正: `surfaceY = 49` の根拠として書かれていた「`SEA_LEVEL=48` のすぐ上」は誤り

本文書は以前、`surfaceY = 49` を「plan.md §3.7 の参照実装実測 `SEA_LEVEL=48` のすぐ上。
水に接する挙動が『1 ブロック掘る』で到達できる」と説明していた。**両方とも成立しない。**

- 参照実装の `SEA_LEVEL` は **63** である(`<reference-impl>/packages/core/domain/constants.ts:17`)。
  48 という値は plan.md §3.7 の誤りで、mc-worldgen の
  [public-api.md](https://github.com/nerima-games/mc-worldgen) §1 が
  `SEA_LEVEL = 63` / `LAKE_LEVEL = SEA_LEVEL` として実測で訂正している。
- したがって 49 は海面の「すぐ上」ではなく、海面より **14 ブロック下**である。
  「1 ブロック掘れば水に届く」という記述は 63 のもとでは端的に偽である。
- そもそもこの平地ワールドは**水を一切生成しない**(平地・カーバー無し・湖無し)。
  海面定数はこの既定値の根拠になりえない。

**49 は「地表として妥当な範囲にある任意の平地の高さ」以上の意味を持たない。**
既定値の実質的な制約は `spawnKit.feetPosition` = `surfaceY + 1` = 50 との整合だけである
(`domain/launch-options.ts`、`test/launch-options.test.ts` が 49 / 50 をリテラルで固定している)。

海面基準の根拠を本当に持たせたいなら既定は 64(= `SEA_LEVEL + 1`)であるべきだが、
それは既定値の変更であり、`DEFAULT_FLAT_WORLD` / `DEFAULT_SPAWN_KIT` と
それを固定しているテストの変更を伴う。**本文書は現在の実装値 49 を記述するにとどめ、
誤った根拠のほうを取り下げる。** なお `domain/launch-options.ts:103` のコメントにも
`SEA_LEVEL as 48` が残っている(別途訂正が必要)。

「ミニ」と「平地」はどちらも意味がある。**平地**なのは、レッドストーンリピータを検証している
プレビューが同時に洞窟カーバーも検証してしまわないため。**ミニ**なのは、起動バジェットが
1 秒で、その中の最大項目が地形生成だから（[design-notes.md](./design-notes.md) DN-02）。

### 2.5 `spawnKit` — 何を持って、どこに立つか

```typescript
export type ItemId = string        // 暫定。本来は mc-kernel の ItemType
export type HotbarSlot = { readonly item: ItemId; readonly count: number }

export type SpawnKit = {
  readonly feetPosition: Position   // 足元原点。既定 (0, 50, 0)
  readonly yawRadians: number       // 既定 0（-Z を向く）
  readonly pitchRadians: number     // 既定 0（水平）
  readonly hotbar: ReadonlyArray<HotbarSlot>
}
```

**`feetPosition` は足元原点であり、AABB 中心でも目線でもない。** plan.md §3.4:

> ブロックは `[y, y+1]` を占有。スポーンと物理平面は `surfaceY+1` 基準
> 「物が浮く」バグ類は例外なく**足元原点 vs AABB中心のY規約不一致**が原因

既定は `surfaceY + 1 = 50`。`surfaceY` そのものに置くと足元がブロックの中に入り、
衝突リゾルバが 1 フレーム目に**目に見える形で**上へ押し出す。
現状は `feetPosition` というフィールド名で規約を運んでいる（mc-sim と同じ暫定）。
mc-kernel でブランド型に格上げされたら追随する。

既定のホットバーが空でないのは「最初の 2 操作がチェストを探すことと道具を探すことである
プレビューは、誰も 2 回は起動しない」から。

**既定のスポーン位置は、上書きされた `world.surfaceY` に追随しない。** 意図的である。
既定値が他の呼び出し側指定値の関数になると、「何も渡さなければ何が出るか」が
「この部分集合を渡したら何が出るか」に変わり、部分集合は組合せ爆発する。
`test/launch-options.test.ts` の
`the spawn point does NOT follow an overridden surface height` が固定している。

### 2.6 `modules` — plan.md §4.1 の契約の半分

```typescript
export type PreviewModule = Pick<GameModule<never, never, never>, 'frameStages'>
```

**`GameModule` の `frameStages` だけを取り、`layers` は取らない。**
理由 2 つは [responsibility.md](./responsibility.md) §3.3 に詳述（compose の仕事の二重実装になる /
異種リストが型付けできない）。

新しい interface を書かず `Pick` にしてあるのは、

- 本物の `GameModule` が構造的にそのまま代入できるようにするため
- plan.md §4.1 が変わったらこのファイルが壊れるようにするため

の 2 点。

付随する公開関数:

```typescript
export const flattenStages:
  (modules: ReadonlyArray<PreviewModule>) => ReadonlyArray<StageRegistration>

export type StageOrderViolation = {
  readonly stage: StageId
  readonly mustFollow: StageId
  readonly declaredIndex: number
  readonly constraintIndex: number
}

export const stageOrderViolations:
  (modules: ReadonlyArray<PreviewModule>) => ReadonlyArray<StageOrderViolation>
```

`stageOrderViolations` は**トポロジカルソートではない**。
[architecture.md](./architecture.md) §4.3 が全文。以下は違反にしない:

- **不在の stage を指す `after`** — `mc-kernel/domain/frame.ts:46-54` が
  「不在の stage へのエッジは無いものとして扱う」と定めている。プレビューは定義上
  ゲームの部分集合なので、これがここでは常態
- **自己エッジ・重複 ID** — 重複 ID の意味を決めるのは compose であって、ハーネスではない。
  最初の出現位置を採り、それ以上は言わない

## 3. `PlaygroundHandle` — 「起動済みミニゲーム」

```typescript
export type PlaygroundHandle = {
  readonly options: ResolvedLaunchOptions
  readonly timings: ReadonlyArray<PhaseTiming>
  readonly budget: BootBudgetVerdict
  readonly stageOrderWarnings: ReadonlyArray<StageOrderViolation>
  readonly submitFrame: (dt: DeltaTimeSecs) => Effect.Effect<void>
  readonly framesRendered: Effect.Effect<number>
  readonly cameraPose: Effect.Effect<CameraPoseSnapshot>
  readonly isRunning: Effect.Effect<boolean>
  readonly stop: Effect.Effect<void>
}
```

| メンバ | 意味 |
| --- | --- |
| `options` | 既定を埋めた後の値。**要求した設定ではなく、実際に起動した設定** |
| `timings` | phase ごとの実測。順序は `BOOT_PHASE_ORDER` |
| `budget` | `timings` の判定結果（§4）。起動時にログにも出る |
| `stageOrderWarnings` | 空でなければ、そのプレビューは作者自身の制約と矛盾する順序で動いている |
| `submitFrame` | フレームを 1 つ投入。停止後は**黙って無視**する |
| `framesRendered` | この起動でポンプが完了したフレーム数。**起動直後は 1**（boot が 1 フレーム回すため）。停止後は 0 |
| `cameraPose` | mc-sim が発行した姿勢の**読み取り**。書き戻す口は無い |
| `isRunning` | |
| `stop` | 冪等・非ブロッキング。boot の**逆順**で detach |

前 4 つが Effect ではなく素の値なのは、**ハンドルが存在する時点で boot は終わっている**から。
変わりようがないものを Effect にすると、呼び出し側に「いつ読むべきか」という無い問題を与える。

### 3.1 `submitFrame` が delta を取る理由

タイムスタンプではなく delta を取り、クランプは一切しない。
[responsibility.md](./responsibility.md) §3.5 に理由。要約: クランプは mc-sim の所有物であり、
2 つ目の実装が食い違ったときの症状は「床抜け」= 物理のバグに見える。

`test/playground.test.ts` の `does no clamping of its own — mc-sim owns the delta clamp` が
30 秒の delta を素通しすることを assert している。**これは仕様であって手抜きではない**、
という主張をテスト名に込めてある。

### 3.2 1 フレームの中身

```
simulation.tick(dt)
  → 呼び出し側 stage を宣言順に run(dt)      （ClockPort を provide）
  → simulation.cameraPose                    （plan.md §4.2 の camera-mirror に相当）
  → renderer.renderFrame(dt, pose)
```

plan.md §4.2 の標準 stage 順序から、プレビューに無いものを削った骨格である。
`cameraPose` の読み取りが simulation の**後**にあることが、姿勢所有権の実行順序上の表現。

全体は `Effect.catchAllCause` で包む。`catchAll` ではない: stage 内の throw は `Cause.Die` になり、
`catchAll` はそれを見逃してポンプごと落とす。**1 フレーム目で真っ黒になるプレビューは
何も教えてくれない**（`ts-minecraft/packages/game/application/game-loop.ts:123-125` と同じ判断）。

## 4. 起動バジェット API

```typescript
export type BootPhase =
  | 'resolve-options' | 'world' | 'simulation' | 'renderer'
  | 'input' | 'modules' | 'first-frame'

export const BOOT_PHASE_ORDER: ReadonlyArray<BootPhase>
export const BOOT_PHASE_BUDGET_MILLIS: Readonly<Record<BootPhase, DurationMillis>>
export const BOOT_BUDGET_MILLIS: DurationMillis   // 1000

export type DurationMillis = number & Brand.Brand<'DurationMillis'>
export const elapsedMillis: (fromSecs: number, toSecs: number) => DurationMillis

export type PhaseTiming = { readonly phase: BootPhase; readonly durationMillis: DurationMillis }
export type PhaseOverrun = { phase; durationMillis; budgetMillis; overByMillis }

export type BootBudgetVerdict = {
  readonly withinBudget: boolean
  readonly totalMillis: DurationMillis
  readonly overBudgetMillis: DurationMillis
  readonly missingPhases: ReadonlyArray<BootPhase>
  readonly overrunPhases: ReadonlyArray<PhaseOverrun>
}

export const classifyBootTimings: (timings: ReadonlyArray<PhaseTiming>) => BootBudgetVerdict
export const describeBootVerdict: (verdict: BootBudgetVerdict) => string
```

| phase | 配分 (ms) | 所有リポジトリ |
| --- | ---: | --- |
| `resolve-options` | 5 | kit（純粋関数） |
| `world` | 400 | mc-worldgen |
| `simulation` | 120 | mc-sim |
| `renderer` | 300 | mc-render |
| `input` | 25 | **mc-render**（plan.md §2.3-2） |
| `modules` | 50 | 呼び出し側 |
| `first-frame` | 100 | 全員 |
| **合計** | **1000** | |

**配分は実測ではなく割り当てである。** Port の向こうに実装が無いので、まだ 1 度も
実際に計測されていない。それでも今記録するのは、着手前に合意したバジェットは設計制約であり、
後から導出したバジェットは起きたことの記述にすぎないからである。
`test/boot-phase.test.ts` が合計 1000 をリテラルで固定しているので、
後の再配分は 1 秒の中でやるしかない。

判定の 2 つの決定事項（どちらも [design-notes.md](./design-notes.md) DN-02 に理由）:

- **phase が欠けていたら `withinBudget: false`。** 何もしない起動が最速になる指標は、
  作業を速くするのではなく削ることを推奨してしまう
- **合計が範囲内でも、自分の配分を超えた phase は報告する。** レンダラがたまたま速くて
  収まっている `world` は、ワールドが少し育った瞬間に破綻する

`input` が最安なのに独立した phase なのは、その所有権が本リポジトリの憲法だからである
（[architecture.md](./architecture.md) §4.2）。名前と数字のある行項目は、
`renderer` に畳み込まれた手順より、こっそりローカル実装される可能性が低い。

## 5. Port（`application/preview-ports.ts`）

4 つ。plan.md §3.10 の依存リストと 1 対 1（mc-kernel は語彙であってサービスではないので現れない）。

```typescript
export type WorldProviderService = {
  readonly openFlatWorld: (spec: FlatWorldSpec) => Effect.Effect<void>
  readonly closeWorld: Effect.Effect<void>
}

export type SimulationService = {
  readonly spawn: (kit: SpawnKit) => Effect.Effect<void>
  readonly tick: (dt: DeltaTimeSecs) => Effect.Effect<void>
  readonly cameraPose: Effect.Effect<CameraPoseSnapshot>   // 読み取りのみ
  readonly stop: Effect.Effect<void>
}

export type RendererService = {
  readonly attach: Effect.Effect<void>
  readonly renderFrame: (dt: DeltaTimeSecs, pose: CameraPoseSnapshot) => Effect.Effect<void>
  readonly detach: Effect.Effect<void>
}

export type PreviewInputService = {
  readonly attach: Effect.Effect<void>
  readonly detach: Effect.Effect<void>
}

export type PlaygroundPorts = WorldProviderPort | SimulationPort | RendererPort | InputPort
```

`openFlatWorld` が `generateChunk`（plan.md §3.7 の実 API）ではないのは、
**ハーネスがチャンク座標を選ぶ筋合いが無い**から。「この形の平地を、立てる状態で」とだけ言い、
それが何コストかは mc-worldgen が決める。

`renderFrame` が姿勢を引数で受けるのは §3.2 のとおり。

`InputPort` に実装が無いことについては [responsibility.md](./responsibility.md) §3.1。

## 6. 参照実装との照合

plan.md §3.10 の移植元は **「なし（新規）」**。以下は「対応物がある / ない」の明示である。

| 本リポジトリの要素 | 参照実装の対応物 | 判定 |
| --- | --- | --- |
| 起動シーケンス（world → sim → renderer → input） | `packages/app/application/main/session-bootstrap-orchestration.ts`（231 行） | **近縁。ただし性質が違う**。§6.1 |
| `LaunchOptions` の正規化 | **無い**。参照実装のセッションは `BootContext` + 40 近いサービスを引数で受け取る | 新規 |
| 起動バジェット / phase 別計測 | **無い**。参照実装が持つのは逆で、最低表示時間 2500ms と FPS ゲート（`session-loading-gates-state.ts:1-5`） | 新規。§6.2 |
| 再入可能な `launch` + 明示 `stop` | `packages/game/application/game-loop.ts:141-148, 198-201` | **概念は同一**。参照実装は後付け、こちらは初日から |
| dropping queue のフレームポンプ | `packages/game/application/game-loop.ts:106` | 同一（容量 60 も同じ） |
| `catchAllCause` によるフレーム防護 | `packages/game/application/game-loop.ts:123-125` | 同一 |
| stage 順序の検査 | **無い**。参照実装は合成層に全順序をハードコードしている | 新規 |
| `InputPort`（実装なし） | `packages/presentation/input/input-service.ts`（337 行） | **意図的に持たない**。所有権は mc-render |

### 6.1 参照実装のセッション起動との違い

`session-bootstrap-orchestration.ts` は `buildSessionBootstrapOrchestration(deps)` という
単一関数で、冒頭 50 行が `rendering` / `world` / `gameplay` / `presentation` / `inventory` /
`entity` / `multiplayer` の 7 グループから**約 40 個のサービスを分解代入**している（:27-54）。
そこから scene → world → mods → lighting → runtime と積み上げ、最後に 7 個の値を返す。

これは**出荷ゲームのセッションとしては正しい**。本物のセッションはこれら全部を必要とする。

kit がやるのは同じことの縮小版ではない。**4 つの Port しか知らない**。
プレビューが必要としないもの（ポーズメニュー、実績、村、ネザー、mods、マルチプレイヤーの
シード交渉）を「小さくする」のではなく、**最初から知らない**。
これが 231 行と 1 関数の違いを生んでいる。

### 6.2 起動時間の対比 — 参照実装の実測定数

```
packages/app/application/main/session-loading-gates-state.ts:1
  const MIN_LOADING_SCREEN_DURATION_MS = 2500
packages/app/application/main/session-loading-gates-state.ts:2-5
  const INITIAL_FPS_GATE_TARGET = 120
  const INITIAL_FPS_GATE_TIMEOUT_MS = 8_000
  const INITIAL_FPS_GATE_POLL_MS = 100
  const INITIAL_FPS_GATE_STABLE_SAMPLES = 10

packages/app/application/main/session-lifecycle-startup.ts:104-105
  yield* waitForInitialFrameRate(runtimeParams.hud.fpsElement)
  yield* loadingScreen.hide()
```

120fps を 100ms 間隔で 10 サンプル連続 = **最低 1 秒のポーリング**を、
**2.5 秒のローディング画面最低表示**の上に積む。タイムアウトは 8 秒。

ゲームとしては正しい。プレイヤーがワールドを開くのは 1 日に数回で、
最初の可視フレームの前に安定したフレームレートが出ていることには待つ価値がある。

**プレビューには致命的である。** レッドストーンのルールをいじっている開発者は
1 時間に何十回も relaunch する。1 回あたり 2.5 秒の強制待機は、
仮説を確かめるか確かめないかの差になる。**kit がこのパスを継承しないことが存在理由**である。
`test/boot-phase.test.ts` の
`REGRESSION: the whole budget is smaller than the reference session could ever be` が
`BOOT_BUDGET_MILLIS < 2500` を assert している。

## 7. APIロック

plan.md §6 Step 0-3 / §9 未決。ツールは未選定（api-extractor 相当の Effect-TS 互換手段）。

本リポジトリの API ロックの優先度は、mc-sim ほど高くない。
下流が devDependency のみなので、界面が揺れても出荷ビルドは壊れないためである
（[versioning.md](./versioning.md) §3.1）。
それでも publish 開始（plan.md §6 Step 3）までには必要で、理由は
「`launchPlayground()` が無引数で完結する」という §2.1 の契約が、
公開シンボル一覧の diff で守れる種類の約束だからである。
