# テスト / 検証

## 1. plan.md が要求する検証（§3.10）

> **検証**: 自身の最小E2E（起動→操作→スクリーンショット）

15 リポジトリの中で、検証要件が**これ 1 行だけ**なのはここだけである。
他は「ユニットテスト + 内蔵プレビュー」の 2 本立てだが、kit は違う。

理由は、**kit にとってプレビューと検証は同じものだから**である。
mc-worldgen の地形プレビューは「mc-worldgen が正しいこと」を人間に見せる装置だが、
kit の最小プレビューは「**kit がプレビューを起動できること**」の証明そのものである。
ハーネスが自分自身をハーネスとして使う。

| 検証 | 何を保証するか | 状態 |
| --- | --- | --- |
| Node 決定論テスト | 順序・後始末・再入可能性・バジェットの算術が正しいこと。CI で高速に回る | **実装済**（`test/` 5 ファイル / 100 テスト） |
| 内蔵プレビュー（起動 → 操作） | **人間が起動を見て、フェーズ別にコストを読めること** | **実装済**（[`apps/preview-harness/`](../apps/preview-harness/README.md)） |
| ── うちスクリーンショット | **ブラウザで実際に立ち上がって絵が出ること** | **未実装。§2.1 を見ること** |

plan.md §3.10 の検証要件は後者である。前者は plan.md が明示していないが、
[design-notes.md](./design-notes.md) の各 DN を回帰テストとして焼き込むために不可欠であり、
かつ DN-07 の「E2E 環境は SwiftShader でポインタロックが無い」という制約下では
**E2E で検証できないことが多すぎる**ため、実質的に必須である。

## 2. 完了条件（plan.md §6 Step 2）

> 各リポジトリの完了条件: ユニット/シナリオテスト green + **内蔵プレビューが操作可能**

kit の場合これは「テスト green **かつ** 最小 E2E（起動→操作→スクリーンショット）が動く」である。

内蔵プレビューは [`apps/preview-harness/`](../apps/preview-harness/README.md) にあり、
`pnpm preview` で起動する。`pnpm verify` には入らないが、`pnpm typecheck`
（`tsconfig.preview.json`）と `pnpm lint` と `pnpm check:deps` の対象には入っている。
**「起動 → 操作」は満たした。「スクリーンショット」はまだである。**

### 2.1 スクリーンショットの半分が無い理由 —— 4 つ、正確に

1. **本物の Port Layer が無い。** `application/preview-ports.ts` は 4 つの
   `Context.Tag` とサービス型だけで、`Layer.succeed` が**意図的に 1 つも無い**。
   本物には mc-worldgen / mc-sim / mc-render の publish と pin が要る
   （plan.md §6 Step 3）。何も publish されていない。
2. **ブラウザが要る。** スクリーンショットはピクセルの写真であり、
   mc-render は THREE.js も `lib.DOM` も出荷していない。
3. **`@playwright/test` が組織のどのリポジトリの依存にも入っていない。**
   `playwright.config.ts` も `e2e/` も無い。足すのは package.json の 1 行ではなく、
   CI 実行時間についての決定である。
4. **ベースライン方針が無い。**「同じ絵とは何か」の合意が無いスクリーンショットテストは、
   フォント更新で落ちるテストである。plan.md §3.10 は Playwright が SwiftShader 上で
   動くと記録しているので、ベースラインを開発機から取ることもできない。

### 2.2 それでも今日測れるもの ——「1 秒で確実に起動する」

plan.md §3.10 は kit を「**最も丁寧に作る**」部分と呼ぶ。理由は他の全リポジトリの
プレビュー起動がここに乗るからで、成り立たねばならない性質は
**約 1 秒で、確実に起動する**ことである。

**それは今日測れる。しかも Port が注入されているからこそ測れる。**
`apps/preview-harness/` は 4 つの fake Port と 1 つの `ClockPort` をプログラムし、
起動し、操作し、破棄し、再起動して、ブートバジェットを**フェーズ別に**出す。

**壁時計で測ったブートバジェットはベンチマークである。** 負荷のかかった CI で落ちる
ベンチマークは削除される。このアプリが出すミリ秒はすべて fixture がプログラムした
`ClockPort` 由来なので、ノート PC でも CI でも同じ数字になる。

`--stats` は数値レポートで、**3 件の発見**に file:line と再現コマンドを付けて出す。

| # | 内容 | 場所 |
| --- | --- | --- |
| KIT-1 | **世代交代した handle の `stop()` が、生きているプレビューの Port を落とす。** `isRunning` も `current` も `framesRendered` も健全なまま | `application/playground.ts:389-393` |
| KIT-2 | 1 回の launch でモジュールの `frameStages` が 2 回評価される。2 回目は `phase()` の外で、`stageOrderWarnings` はそちらから導かれる | `application/playground.ts:344`, `:352` |
| KIT-3 | `elapsedMillis` が非有限入力で throw する。doc は負値の話しかしていない | `domain/boot-phase.ts:99-100` |

KIT-1 は本書 §8 の「まだ書いていないテスト」の一部でもある
（`test/playground.test.ts:485` は**正しいことについてのテスト**だが、
ガードが既に守っている 2 つのフィールドしか見ていない）。
全件の詳細は [`apps/preview-harness/README.md`](../apps/preview-harness/README.md)。

### 2.3 本物の Layer ができたとき

`apps/preview-harness/harness.ts` の fixture が、4 つの Layer が満たすべき形そのものである。
E2E はそこに差し込む。現在のプレビューはその**代わりではなく**、
それ無しで確かめられる半分である。

したがって kit も mc-sim と同じ 2 段階になる。

1. **いま**: Node の決定論テストで順序・後始末・再入可能性・バジェット算術を固定する（達成済み）
2. **mc-worldgen / mc-sim / mc-render が揃ってから**: 実 Layer を注入した最小 E2E を書く（完了条件）

この順序は避けられない。

### 2.2 最小 E2E に書くこと（設計済み・未実装）

plan.md §3.10 の「起動→操作→スクリーンショット」を、DN-07 の環境制約の下で実現する。

| 段階 | やること | DN-07 由来の制約 |
| --- | --- | --- |
| 起動 | `launchPlayground()` を**無引数で**呼ぶ | 既定値だけで立つことが §2.1 の契約 |
| 操作 | mc-render の**仮想入力**で前進とカメラ回転を与える | **ポインタロックはヘッドレスで使えない**（`e2e/gameplay/player-controls.e2e.ts:208`）。`setVirtualKey` / `addVirtualLookDelta` を使う |
| スクリーンショット | 1 枚撮って、前回と比較する | ワールドのシードが固定なので比較可能（`DEFAULT_FLAT_WORLD.seed = 0`） |
| relaunch | もう一度 `launchPlayground()` して、同じスクリーンショットが撮れる | **ここが kit 固有**。DN-03 の relaunch 保証をブラウザで確かめる唯一の場所 |

**書かないこと**（すべて DN-07 に理由）:

| 書かないもの | 理由 |
| --- | --- |
| FPS のアサーション | SwiftShader 下の FPS は環境較正が要る（`e2e/gameplay/fps-threshold.e2e.ts:5-8` は CI 10 / local 12）。フレームレートは mc-render / mc-compose の関心事 |
| 起動バジェット（1 秒）の検証 | **SwiftShader 下の 1 秒は実機の 1 秒ではない。** バジェットは Node の純粋関数テストと実機の手動計測で見る |
| ポインタロックを要求する操作 | ヘッドレスで不可 |
| ゲームルールの検証 | kit はルールを持たない（[responsibility.md](./responsibility.md) §3） |

**Playwright の設定**（導入時に参照実装から移植する値）:

| 設定 | 値 | 出典 |
| --- | --- | --- |
| launch args | `--use-gl=angle` / `--use-angle=swiftshader` / `--enable-unsafe-swiftshader` ほか | `playwright.config.ts:31-42` |
| `PLAYWRIGHT_USE_SWIFTSHADER` | `'1'` | `playwright.config.ts:5` |
| `workers` | **1**（参照実装は CI 1 / local 2） | 並列ゲームインスタンスがレンダーループを飢えさせ合成キー入力を落とす（`playwright.config.ts:11-15`）。ハーネスの検証にそのノイズを混ぜない |
| `retries` | **0** で始める | 参照実装は 1。kit の E2E がリトライを必要とするなら、それはハーネスの不安定さの証拠であって隠すべきではない |

`retries: 0` は参照実装からの意図的な逸脱である。参照実装のリトライは
「70 本の重い E2E を 2 worker で回す」ための実務的な妥協だが
（plan.md の公称は 64 本。実測は 70 本 / 23 ファイル。[porting.md](./porting.md) §3.6）、
kit の E2E は数本しかなく、しかも**安定性そのものを検証している**。
フレーキーなら直す対象はテストではなくハーネスである。

## 3. 現在のテスト

`vitest run`。**5 ファイル / 100 テスト**、実行 1 秒未満。

| ファイル | テスト数 | 対応する DN |
| --- | ---: | --- |
| `test/check-dependency-whitelist.test.ts` | 32 | **DN-01**（devDependency 専用）/ DN-09 |
| `test/boot-phase.test.ts` | 20 | **DN-02**（1 秒バジェット）/ DN-09 |
| `test/playground.test.ts` | 20 | **DN-03**（再入可能）/ **DN-04**（teardown 逆順）/ DN-05 / DN-06 / DN-08 |
| `test/launch-options.test.ts` | 19 | DN-02 / **DN-05**（stage 順序の検査） |
| `test/kernel-mirror.test.ts` | 9 | `domain/kernel-vocabulary.ts` が mc-kernel と同形であること（§3.1） |

`check-dependency-whitelist.test.ts` が最大なのは偶然ではない。
**本リポジトリの憲法（devDependency 専用）を守るのがこのゲートだから**である。

### 3.1 `test/kernel-mirror.test.ts` が守っているもの

`domain/kernel-vocabulary.ts` は「削除して import を publish 済みパッケージに向け直せば型検査が通る」と
約束している。**その約束は何にも強制されておらず、ロスターの他所では既に破られていた。**

`ClockPort` は `Context.Tag` であり、Effect は Tag を**その文字列キー**
（`'@nerima-games/mc-kernel/ClockPort'`）で解決する。したがって全リポジトリのミラーは
実行時には同じ 1 つのサービスでありながら、TypeScript にとっては無関係な名前的別型である。
mc-sim のミラーは `ClockService` を 1 フィールドで持っており（kernel と本リポジトリは 2 フィールド）、
本リポジトリは mc-sim に依存するので両者は同じバンドルに同居する——
**狭い側の `Layer` が広い側の Tag を満たし、`wallClockEpochMillis` が `undefined` になる。**
`tsc` は最後まで何も言わない。

同じ根を持つ 2 件目がブランドである。`Brand.Brand<'DeltaTimeSecs'>` も文字列でキーされるので、
mc-physics が `[0.001, 0.05]` に refine していた `DeltaTimeSecs` と
kernel の「有限かつ非負」の `DeltaTimeSecs` は、**検証の中身が違うのに TypeScript には同じ型**だった。

このファイルはその両方を assert する:

| it | 何を固定するか |
| --- | --- |
| `uses kernel’s tag key verbatim, which is why the shape has to match` | Tag キーを文字列リテラルで固定。ハザードの根そのもの |
| `REGRESSION: the mirrored ClockService is not NARROWER than kernel’s` | 狭めたら落ちる |
| `REGRESSION: the mirrored ClockService is not WIDER than kernel’s` | 広げても落ちる。**両方向**であることが要点 |
| `REGRESSION: FixedClockLayer takes kernel’s object argument, not a bare reading` | シグネチャの drift |
| `mirrors kernel’s FrameServices alias rather than narrowing it to never` | `FrameServices` は kernel と同じく `ClockPort` の別名 |
| `DeltaTimeSecs is finite and non-negative — kernel’s refinement, not the clamp` | クランプは量の性質ではなくフレームループの関心事 |
| `MonotonicTimeSecs is finite and non-negative` / `EpochMillis is a safe integer, so a fractional millisecond cannot be persisted` / `StageId and WorldId reject blank strings, as kernel’s identifiers do` | 残りのブランド述語 |

同種のテストが mc-sim と mc-render にもある。

## 4. テストの書き方（本リポジトリの規約）

### 4.1 `@effect/vitest` の `it.effect`

主 API は `it.effect`。純粋な assertion だけの場合も `Effect.sync(() => { ... })` で包む
（テストの実行モデルを 1 つに保つため）。mc-sim / mc-kernel と同じ。

```typescript
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

it.effect('name', () => Effect.sync(() => { expect(...).toBe(...) }))
it.effect('name', () => Effect.gen(function* () { ... }).pipe(Effect.provide(SomeLayer)))
```

`it.effect` + `Effect.forkDaemon` + `Deferred.await` は**動く**
（`test/playground.test.ts` がそうしている）。mc-sim の `docs/testing.md` §4.3 が記録している
mx-ui の注意（DOM イベントフローだとデッドロックする）は、待ち合わせが DOM を跨がない限り関係ない。
**kit のコードは DOM に触れない**（`tsconfig.base.json` の `lib: ["ES2024"]`）ので、
跨ぎようがない。跨ぐ必要が出たら、それは責務境界を越えた合図である。

### 4.2 `environment: 'node'` 固定 — ここが本リポジトリの主張

`vitest.config.ts` は `environment: 'node'`。**ブラウザも DOM も WebGL も Playwright も無い。**

これは制約ではなく設計である。DN-07 が記録するとおり、E2E 環境は
SwiftShader・ポインタロック不可・並列時のキー入力落ちという条件下にあり、
**そこで検証されたことは遅く、フレーキーで、ブラウザが作れる構成でしか確かめられない**。

起動順序・後始末順序・再入可能性・バジェットの算術は、まさにそこで検証してはいけないものである。
だから 4 つの重い surface を Port にした（`application/preview-ports.ts`）。

```typescript
// test/playground.test.ts の fake clock — 壁時計を一切読まない
const nowSecs = yield* Ref.make(0)
const spend = (secs: number) => Ref.update(nowSecs, (value) => value + secs)
Layer.succeed(ClockPort, {
  monotonicSecs: Ref.get(nowSecs).pipe(Effect.map(MonotonicTimeSecs)),
  wallClockEpochMillis: Effect.succeed(EpochMillis(0)),
})
```

Port が「作業した」ぶんだけ時計が進む。**バジェットのテストが CI マシンの負荷で落ちない。**
壁時計を読んでいたら、`REGRESSION: a slow world phase is reported, not absorbed` は
フレーキーテストになっていた。

### 4.3 回帰テストは失敗の名前を付ける

DN-xx に対応するテストは `REGRESSION: ...` で始め、**機能名ではなく失敗の名前**を付ける。

```
REGRESSION: a second launch tears the first down — the second-world-load bug
REGRESSION: no fiber from the first launch survives to see a second launch frame
REGRESSION: a late stop() on a superseded handle does not kill the live preview
REGRESSION: input is detached FIRST, before the renderer it fires into
REGRESSION: the whole budget is smaller than the reference session could ever be
REGRESSION: a missing phase is NOT "under budget" — it is unjudged
```

削除しようとした人に、そのテストが何を守っているかがその場で分かる必要がある。

`KNOWN LIMIT:` 接頭辞も 1 つある（`test/check-dependency-whitelist.test.ts`）。
**塞げていない穴を、塞げているふりをせずにテストで記録する**ための印である
（[design-notes.md](./design-notes.md) DN-01 §1.4）。

### 4.4 定数は算術ではなくリテラルで assert する

```typescript
expect(BOOT_BUDGET_MILLIS).toBe(1000)                    // ○
expect(sum).toBe(1000)                                   // ○
expect(DEFAULT_SPAWN_KIT.feetPosition.y).toBe(50)        // ○
expect(sum).toBe(BOOT_BUDGET_MILLIS)                     // × 両辺が同じ定数を読む
```

両辺が同じ定数を読むテストは、定数を「整理」した瞬間に緑のまま壊れる。
バジェットを 5 秒に上げる変更を検知するのがこのファイルの唯一の存在理由なので、
ここを間違えると何も守っていない。

例外: `expect(DEFAULT_SPAWN_KIT.feetPosition.y).toBe(DEFAULT_FLAT_WORLD.surfaceY + 1)` は
リテラル版と**両方**書いてある。リテラルが値を固定し、算術版が「なぜその値なのか」
（plan.md §3.4 の `surfaceY+1` 規約）を記録する。

### 4.5 fake は 1 つの共有イベントログを持つ

`test/playground.test.ts` の `makeFakes` は 4 つの Port すべてを 1 本の
`Ref<ReadonlyArray<string>>` に記録する。

```typescript
expect(yield* fakes.events).toStrictEqual([
  'world.open:playground', 'sim.spawn:y=50', 'renderer.attach', 'input.attach',
  'input.detach', 'renderer.detach', 'sim.stop', 'world.close',
  'world.open:playground', 'sim.spawn:y=50', 'renderer.attach', 'input.attach',
])
```

**このテストの主題は「異なるリポジトリの surface に触る順序」**であり、
Port ごとに別々のログを持っていたらそれを表現できない。

### 4.6 型が assertion であることがある

`test/launch-options.test.ts` の
`an explicit undefined FIELD means "not supplied", not "blank it out"` は、
`exactOptionalPropertyTypes` 下で**コンパイルが通ること自体**がアサーションである。
`LaunchOptions` のフィールドが `?: T` に変わったら `pnpm typecheck` が落ちる。

こういうテストにはコメントでそう書くこと。書かないと「実行時に何も検証していない」
と判断されて消される。

## 5. カバレッジ

**閾値は現在設定していない。意図的である。**

参照実装は branches / functions / lines / statements の 99% を強制している
（`docs/reference/shipping-readiness-2026-07-10.md`）。
スケルトンに 99% を課しても意味がない: 型だけのモジュール数個で自明に満たされ、
本実装の品質について何も言わない。

- 計測とレポートは常に動く（`pnpm test:coverage`、CI でもアーティファクト化）。
- **99% ゲートは完了条件（§2）到達時に `vitest.config.ts` と CI の両方で有効化する。**
  `vitest.config.ts` の `coverage.thresholds` にコメントアウトした形で置いてある。

kit 固有の注意: **カバレッジは Port の向こう側を測れない。** 本リポジトリのコードは
4 つの Port を呼ぶだけなので、fake を通せば行カバレッジは容易に高くなる。
99% を達成しても「実 Layer で 1 秒以内に起動する」ことは 1 ミリも保証しない。
**それを保証するのは §2.2 の E2E だけである。**

## 6. CI

`.github/workflows/ci.yaml`。`pnpm verify` と同じ内容 + カバレッジ。

```
typecheck (build + test の 2 プロジェクト)
  → lint (oxlint)
  → check:deps (依存ホワイトリスト + 循環 + Date.now() 禁止)  ← ハードゲート
  → api:check (api-lock.md が公開 API と一致するか)          ← ハードゲート
  → test
  → coverage (閾値なし、アーティファクト化)
```

`API lock` を `verify` 経由だけでなく独立ステップにしてあるのは、ステップ名を見ただけで
落ちた理由が分かるようにするため（[public-api.md](./public-api.md) §7）。

`check:deps` は plan.md §5.1-4「依存ホワイトリストCIを初回コミットから」の実体。
参照実装の `check-package-dag.ts` は警告を出して常に 0 で終了していた
（落ちないゲートはゲートではなくドキュメントである）。本リポジトリのものは
違反があれば必ず非ゼロ終了する。

E2E ジョブは §2.2 の実装時に追加する。SwiftShader を使う以上 Linux ランナーで動くが、
`workers: 1` にするので実行時間は素直に本数に比例する。

## 7. これから必要なテスト

[design-notes.md](./design-notes.md) の「（要追加）」印を参照。特に重要な未実装:

| テスト | 対応 | いつ |
| --- | --- | --- |
| **最小 E2E（起動→操作→スクリーンショット）** | DN-07 | **完了条件。** 4 Port の実装が揃ってから |
| `a real boot with real Layers stays inside 1000ms` | DN-02 | 同上。**現状のバジェットテストは算術しか見ていない** |
| `no fiber survives teardown`（`Fiber.roots` 相当） | DN-03 | 本実装時。現状は「旧ハンドルが新フレームを見ない」で代用しており必要条件にすぎない |
| `100 consecutive relaunches leak neither memory nor listeners` | DN-03 | 本実装時 |
| `a failing detach does not prevent the remaining teardown steps` | DN-04 | 失敗する fake を足す |
| `no InputService implementation exists in this repository` | DN-01 | ソース走査 |
| `the kit does not export a topological sort` | DN-05 | **API ロックが担当。下記** |
| `FIRST_FRAME_DELTA_SECS equals mc-sim's` | DN-06 | mc-sim 公開時。直後にこの定数を削除する |
| `no escape-hatch comment exists in this repository` | DN-09 | ソース走査 |

**APIロックの diff はこの表から外れた。** 実装済みで、しかも vitest のテストではない。
「コミット済みの `api-lock.md` が現在の公開面と一致するか」は `pnpm api:check` が見る
（`pnpm verify` と CI の両方で走る）。DN-05 の「順序解決器を export しない」は、
`resolveStageOrder` 相当が `api-lock.md` の公開シンボル一覧に**現れた**時点で
`api:check` が落ちるので、専用テストを書かなくても守られる
（[public-api.md](./public-api.md) §7、[versioning.md](./versioning.md) §4.1）。

vitest 側の `test/api-lock.test.ts` が見ているのは生成器 `scripts/api-lock.ts` の機構そのもの
（並びのロケール非依存性、可搬性ガード、スナップショットの往復、失敗時の diff）であり、
16 リポジトリに byte-identical で vendor されている。
