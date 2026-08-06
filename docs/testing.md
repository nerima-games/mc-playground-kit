# テスト / 検証

## 1. plan.md が要求する検証（§3.10）

> **検証**: 共通ライフサイクルの決定論テスト。実DOM/WebGLを含むゲームE2Eは mc-compose が担う。

15 リポジトリの中で、検証要件が**これ 1 行だけ**なのはここだけである。
他は「ユニットテスト + 内蔵プレビュー」の 2 本立てであり、kitも同じである。

理由は、**kit にとってプレビューと検証は同じものだから**である。
mc-worldgen の地形プレビューは「mc-worldgen が正しいこと」を人間に見せる装置だが、
kit の最小プレビューは「**kit がプレビューを起動できること**」の証明そのものである。
ハーネスが自分自身をハーネスとして使う。

| 検証 | 何を保証するか | 状態 |
| --- | --- | --- |
| Node 決定論テスト | 順序・後始末・再入可能性・バジェットの算術が正しいこと。CI で高速に回る | **実装済**（`test/` 5 ファイル / 100 テスト） |
| 内蔵プレビュー（起動 → 操作） | **人間が起動を見て、フェーズ別にコストを読めること** | **実装済**（[`apps/preview-harness/`](../apps/preview-harness/README.md)） |
| ── うちスクリーンショット | **ブラウザで実際に立ち上がって絵が出ること** | **mc-compose のE2Eで実装・検証済み** |

plan.md §3.10 の検証要件は後者である。前者は plan.md が明示していないが、
[design-notes.md](./design-notes.md) の各 DN を回帰テストとして焼き込むために不可欠であり、
かつ DN-07 の「E2E 環境は SwiftShader でポインタロックが無い」という制約下では
**E2E で検証できないことが多すぎる**ため、実質的に必須である。

## 2. 完了条件（plan.md §6 Step 2）

> 各リポジトリの完了条件: ユニット/シナリオテスト green + **内蔵プレビューが操作可能**

kit の場合これは「テスト green **かつ** 内蔵プレビューが操作可能」である。実DOM/WebGLを含む
起動→操作→スクリーンショットは mc-compose のE2Eで検証する。

内蔵プレビューは [`apps/preview-harness/`](../apps/preview-harness/README.md) にあり、
`pnpm preview` で起動する。`pnpm verify` には入らないが、`pnpm typecheck`
（`tsconfig.preview.json`）と `pnpm lint` と `pnpm check:deps` の対象には入っている。
**「起動 → 操作」は満たしている。スクリーンショットを含むゲームE2Eは mc-compose が所有する。**

### 2.1 スクリーンショット検証をmc-composeに置く理由

以下は、kitへブラウザE2Eを追加する案を検討した記録である。現在は責務境界を確定し、
実DOM/WebGLとゲーム挙動の検証を mc-compose に置いている。kitの未解決課題ではない。

#### 検討時点の制約（2026-07-28）

かつてここには 4 つの理由が並んでいた。**そのうち 3 つはもう成り立たない。**
当時は依存ホワイトリストの同期がハードブロッカーだった。

| かつての理由 | いまの状態 |
| --- | --- |
| 1. 本物の Port Layer が無い | **半分は成立可能になった。** `RendererPort` と `InputPort` は mc-render の実物で埋められる（`makeWorldRenderer` / `InputService` は実装済み）。`WorldProviderPort`（mc-worldgen）と `SimulationPort`（mc-sim）は依然 fake しか無い |
| 2. ブラウザが要る。mc-render は THREE.js も `lib.DOM` も出荷していない | **消えた。** mc-render は `application/three-surface.ts` で THREE を**構造的に**受け取り、`application/world-renderer.ts` が実際に WebGL2 コンテキストを取得する。`lib.DOM` を出荷しないのは今も真だが、それは**ホストが `three` と canvas を渡す**設計だからで、障害ではない |
| 3. `@playwright/test` が組織のどのリポジトリにも無い。`playwright.config.ts` も `e2e/` も無い | **明確に偽になった。** mc-compose に両方ある —— `playwright.config.ts`（Chromium + SwiftShader、`webServer` に vite、port 5181、`retries: 0`）と `e2e/smoke.e2e.ts` が動いている |
| 4. ベースライン方針が無い | **ほぼ消えた。** mc-render の [docs/testing.md](../../mc-render/docs/testing.md) §2.5 が実測で片付けている —— SwiftShader は逐次・6 並列・Chromium 147/148 をまたいで **15 枚が同一 sha256**、許容差は **0 でよい**。加えて「rAF ループを撮るな」「`UNMASKED_RENDERER_WEBGL` が SwiftShader でなければ skip」という 2 つの拘束条件も出ている |

#### 5. 実際に残っている唯一のハードブロッカー: **kit の `check:deps` が通さない**（実測）

ブラウザ E2E を書くには `apps/` の下から `@nerima-games/mc-render` を import する必要がある。
**それを入れると `pnpm check:deps` がハード失敗する。** 実測（2026-07-28、入れて確認して戻した）:

```
check-dependency-whitelist: 1 violation(s):
  apps/preview-harness/options.ts:177 [undeclared-dependency] imports @nerima-games/mc-render,
  which is declared in neither "dependencies" nor "devDependencies" of package.json.
```

**そして package.json に足すことは組織が禁じている。**
`mc-dev-meta/scripts/check-repoint.ts` のヘッダが理由を述べている ——
16 リポジトリはそれぞれ自分の CI でも単独ビルドされ、そこでは `workspace:*` が解決しない。
publish 前の兄弟を package.json に書けば、kit 自身の CI の `pnpm install` が壊れる。

**mc-compose はこの穴をすでに塞いでいる。** あちらの
`scripts/check-dependency-whitelist.ts` には `devServerResolved` と `UNPUBLISHED_ROOTS` が
あり、「未 publish ルート（`apps/`）のファイルは、vite alias で解決される兄弟を
package.json 宣言なしに import してよい」という条項になっている。
**kit のコピーにはその機構が無い**（`grep devServerResolved` が 0 件）。

つまりこれは kit の中で完結する配線作業ではなく、
**vendor されているゲートスクリプトを新しい版に揃える作業**である。
当該ファイルは自身のヘッダで「フェンスより下は 16 リポジトリに byte-for-byte でコピーされる」
と宣言しているので、kit だけ先に書き換えると**意図的に同一化してある資産が分岐する。**

**したがって着手の前に決めるべきことは 1 つ**で、それは kit の決定ではない:

> `devServerResolved` / `UNPUBLISHED_ROOTS` を持つ新しい
> `check-dependency-whitelist.ts` を、mc-dev-meta 主導で kit（および他の該当リポジトリ）へ
> 同期するか。

同期さえ済めば、残りは実際に配線作業である。必要なものは
vite（sibling alias、mc-compose の `vite.config.ts` がそのまま雛形）、
`@playwright/test`、`three`、`lib: ["DOM"]` を持つ**新しい** tsconfig プロジェクト
（`tsconfig.preview.json` は DOM を入れないことが設計なので、そこには足さないこと）。

#### この E2E が主張できること / できないこと（同期後に書く人へ）

上の表 1 が残しているのは「4 Port のうち 2 つは依然 fake」である。
**それを黙って混ぜてはならない。** 絵は mc-compose と同じく**空 1 色**になる ——
ワールドデータが無いので、本物のレンダラに描くものが無い。

| 主張できる | 主張できない |
| --- | --- |
| kit の起動列がブラウザで 1 秒バジェットに収まる（実 DOM・実 WebGL 込み） | 何かが**見えている**こと |
| mc-render の**本物の**レンダラが WebGL2 コンテキストを取得した（mc-compose smoke #1 と同じ、自己充足しない 2 つの assertion で） | ワールド生成・シミュレーションが正しいこと（fake である） |
| 実 `window` に登録したリスナが teardown で**全部**外れる（DN-03/DN-04。ここが kit 固有） | スクリーンショットの**内容**の回帰（空 1 色に回帰は無い） |

3 列目が示すとおり、**スクリーンショットは撮れるが比較の意味はまだ薄い。**
比較が意味を持つのは mc-worldgen / mc-meshing が alias 集合に入った日であり、
それは表 1 の行 1 の残り半分と同じ日である。

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

`--stats` は数値レポートで、かつて 3 件の発見を出していた。**3 件とも修正済みで、
それぞれ `test/` のテストが固定している。** `--stats` は今も同じ数字を出すが、
数字の意味が変わった —— 見つけるための数字ではなく、戻っていないことを確かめる数字である。

| # | かつての内容 | いま固定しているテスト |
| --- | --- | --- |
| KIT-1 | 世代交代した handle の `stop()` が、生きているプレビューの Port を落とす（`isRunning` も `current` も `framesRendered` も健全なまま） | `test/playground.test.ts` `REGRESSION: a late stop() on a superseded handle does not kill the live preview` —— `fakes.events` を見る。4 つの呼び出しはそこにしか現れない |
| KIT-2 | 1 回の launch でモジュールの `frameStages` が 2 回評価される。2 回目は `phase()` の外で、`stageOrderWarnings` はそちらから導かれる | `REGRESSION: one launch evaluates a module's frameStages exactly ONCE` / `REGRESSION: the warnings describe the stages the PUMP runs, not a second registration` |
| KIT-3 | `elapsedMillis` が非有限入力で throw する。doc は負値の話しかしていない | `test/boot-phase.test.ts` `REGRESSION: a non-finite reading is a zero, not a defect that kills the launch` |

ブラウザ lifecycle は `test/browser-preview.test.ts` で、非同期 frame の直列化と、active frame の
release が runtime stop より先に完了する teardown 順序を固定している。

`--stats` の `STALE-STOP` は「superseded stop が触った Port」を `(none)` と出し、
`DOUBLE-REGISTRATION` は 1 launch あたり 1 評価を出す。
どちらかが変わったらこの表の行が戻ってきたということである。
全件の詳細は [`apps/preview-harness/README.md`](../apps/preview-harness/README.md)。

### 2.3 本物の Layer ができたとき

`apps/preview-harness/harness.ts` の fixture が、4 つの Layer が満たすべき形そのものである。
E2E はそこに差し込む。現在のプレビューはその**代わりではなく**、
それ無しで確かめられる半分である。

したがって kit も mc-sim と同じ 2 段階になる。

1. **いま**: Node の決定論テストで順序・後始末・再入可能性・バジェット算術を固定する（達成済み）
2. ~~**mc-worldgen / mc-sim / mc-render が揃ってから**~~ → **3 段になった**（§2.1 の実測による）

   | 段 | 条件 | 何が書けるか |
   | --- | --- | --- |
   | 2a | `check-dependency-whitelist.ts` が `devServerResolved` 付きの版に同期される | **mc-render だけを実 Layer にした** E2E。起動・操作・teardown・コンテキスト取得。スクリーンショットは撮れるが空 1 色 |
   | 2b | mc-worldgen / mc-meshing が alias 集合に入る | 絵の**中身**についての主張。ここで初めてスクリーンショット比較が意味を持つ |
   | 2c | 全 4 親が publish される | `application/preview-ports.ts` の 4 Port すべてが実 Layer（完了条件） |

   **2a は mc-render の publish を待たない。** これが 2026-07-28 の実測でいちばん変わった点で、
   かつては「4 つ揃うまで何も書けない」と読める書き方をしていた。

この順序は避けられない。

### 2.2 ブラウザE2Eの責務境界

ブラウザE2Eは kit に追加しない。kit は共通ライフサイクル（canvas、RAF、再起動、停止、
後始末）を提供し、実DOM/WebGLとゲーム挙動を含む縦断検証は `mc-compose` が所有する。
実際のエンド攻略E2Eは `mc-compose/e2e/end-journey.e2e.ts` で、起動からドラゴン撃破、
報酬、帰還ポータル、flush/reload後の永続化まで検証している。

kit 固有のブラウザE2Eを作ると、ゲーム固有のPort実装とPlaywright依存をkitへ持ち込み、
「devDependency専用で出荷ゲームを所有しない」という責務境界を破る。

### 2.3 最小E2Eの検証契約（mc-compose側）

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

`vitest run`。**4 ファイル / 91 テスト**、実行 1 秒未満。

| ファイル | テスト数 | 対応する DN |
| --- | ---: | --- |
| `test/check-dependency-whitelist.test.ts` | 32 | **DN-01**（devDependency 専用）/ DN-09 |
| `test/boot-phase.test.ts` | 20 | **DN-02**（1 秒バジェット）/ DN-09 |
| `test/playground.test.ts` | 20 | **DN-03**（再入可能）/ **DN-04**（teardown 逆順）/ DN-05 / DN-06 / DN-08 |
| `test/launch-options.test.ts` | 19 | DN-02 / **DN-05**（stage 順序の検査） |

`check-dependency-whitelist.test.ts` が最大なのは偶然ではない。
**本リポジトリの憲法（devDependency 専用）を守るのがこのゲートだから**である。

### 3.1 公開済み mc-kernel の直接利用

`ClockPort`、`FrameServices`、ブランド付き共有語彙は `@nerima-games/mc-kernel` から直接
import する。ローカルの `kernel-vocabulary` と mirror-only test は削除済みである。
`pnpm typecheck` が公開型との assignability を検査し、`test/playground.test.ts` が
注入された `ClockPort` を使う起動経路を検査する。ローカルの型ミラーを比較するテストは、
二重の真実を再導入するため持たない。

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

実DOM/WebGLを含むE2Eジョブは mc-compose が所有する。kitのCIへPlaywrightを追加しない。

## 7. これから必要なテスト

[design-notes.md](./design-notes.md) の「（要追加）」印を参照。kit固有の未実装:

| テスト | 対応 | いつ |
| --- | --- | --- |
| 実DOM/WebGLを含むゲームE2E | DN-07 | mc-compose の責務。kitには追加しない |
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
