# 設計注意

plan.md §3.10 の設計注意と、そこから展開される要件を、参照実装の証跡（file:line）付きで並べ、
**それぞれを「書くべき回帰テスト」として名前で表現**したもの。

plan.md §3.10 の設計注意は 1 行しかない。

> 各体験モジュールからは **devDependency としてのみ**参照される。
> 実行時依存に混入したら依存ホワイトリストCIで落とす

これが DN-01 である。残りは、責務（「1秒で起動する糊」）と検証（「自身の最小E2E」）と
移植元（「なし（新規）。E2E環境の知見を流用」）から導かれる要件を、
同じ形式に展開したものである。

パスは `takeokunn/ts-minecraft` リポジトリルート相対。
「状態」列: **済** = 本リポジトリに回帰テストがある / **要** = 本実装時に必須 / **将来** = 該当機能の実装時に。

| ID | 設計注意 | 状態 |
| --- | --- | --- |
| DN-01 | devDependency 専用。実行時依存に混入させない | 済（部分。§1.4 の限界あり） |
| DN-02 | 起動は 1 秒。phase 別に計測し、超過を報告する | 済 |
| DN-03 | `launch` は再入可能。取り残し fiber ゼロ | 済 |
| DN-04 | teardown は boot の逆順。input を最初に外す | 済 |
| DN-05 | stage 全順序を解決しない（検査だけする） | 済 |
| DN-06 | deltaTime クランプを二重実装しない | 済 |
| DN-07 | E2E 環境の制約（SwiftShader / ポインタロック不可 / 仮想入力） | 要 |
| DN-08 | カメラ姿勢は運ぶだけ。書き戻す口を作らない | 済（部分） |
| DN-09 | `Date.now()` / `performance.now()` を使わない | 済 |

---

## DN-01 devDependency 専用。実行時依存に混入させない

### plan.md §3.10 / §2.3-2

> 各体験モジュールからは **devDependency としてのみ**参照される。
> 実行時依存に混入したら依存ホワイトリストCIで落とす

> **実行時入力サービスは mc-render が所有。** kit は devDependency 専用のため、
> kit に入力を置くと本番ゲームから入力が消える

### 何が起きるか

抽象的な規則ではない。具体的な故障モードがある。

1. mx-gameplay の開発者が、プレビューで動く入力処理を便利だと思う
2. 出荷コードから `import { InputService } from '@nerima-games/mc-playground-kit'` する
3. **ローカルでは動く**（dev-meta workspace には kit がある）
4. **`pnpm build` は通る**（TypeScript 的には何も間違っていない）
5. **出荷ビルドに kit が含まれないので、リリースされたゲームはキーボードに反応しない**

4 と 5 の間に人間のレビューしか無い状態にはしない、というのがこの規則である。

### 強制の実体

`scripts/check-dependency-whitelist.ts`:

```
:219  export const DEV_ONLY_PACKAGES: ReadonlySet<string> =
        new Set([`${ORG_SCOPE}/mc-playground-kit`])
:698  dev-only-package-in-shipped-source   （import 側）
:773  dev-only-package-in-dependencies     （package.json 側）
```

16 リポジトリ全部が同じスクリプトを持つので、どこで違反してもそのリポジトリの CI が落ちる。

### 新設計での追加

- **`InputPort` は Tag だけで実装が無い**（`application/preview-ports.ts`）。
  型システムが構造的に守っている: これを満たすには、規則が禁じている実装をここに書くしかない
- **kit を指す実行時エッジが依存グラフに 1 本も無い**ことをテストで固定した。
  入ってくるエッジが無いパッケージは、事故で実行時依存になれない。なるには
  `package.json` を明示的に編集するしかなく、それはゲートが捕まえる

### §1.4 既知の限界（実測）

**本リポジトリ自身のコピーでは `dev-only-package-in-shipped-source` は発火しない。**

`classifyImport` は自己 import を先に判定する（`scripts/check-dependency-whitelist.ts:686-692`）。
`REPOSITORY_POLICY.thisPackage` がここでは kit そのものなので、
kit を import しようとすると常に `self-import` が返る。

これは挙動として正しく（本リポジトリ内では確かに相対 import を使うべき）、
メッセージも適切だが、**この規則の import 側は他の 15 リポジトリのコピーでしか検証できない**。
テストで sibling の policy を偽装して塞ぐ手はあるが、それは
どのリポジトリも実際には走らせていない設定をテストすることになるので採らなかった。

`package.json` 側（`dev-only-package-in-dependencies`）は本リポジトリからも発火し、
テストがある。

### 点線を依存グラフの行にしない理由（実測で訂正）

plan.md §2.1 の `gameplay -.-> kit` / `redstone -.-> kit` は行として存在しない。
理由は `scripts/check-dependency-whitelist.ts:163-168` のとおり
「devDependency は実行時エッジではない」であって、**「循環になるから」ではない**。

実測: `mx-gameplay -> kit` を足しても `findCycles` は空のままである。
kit には入ってくる実行時エッジが無いので、循環を閉じようがない。

実害はもっと地味である。**違反メッセージが嘘になる。**
`mx-gameplay` が `mc-render` を import したとき、現状は正しく `not-whitelisted` だが、
点線を行にすると `transitive-import`「mx-gameplay → kit → mc-render で推移的にしか届かない」
になる。**出荷ビルドに存在しない経路**を根拠にした助言である。

### 書くべき回帰テスト

| テスト名 | 場所 | 状態 |
| --- | --- | --- |
| `this repository sits at the TOP of the runtime graph: nothing depends on it` | `test/check-dependency-whitelist.test.ts` | 済 |
| `this repository is the ONE package DEV_ONLY_PACKAGES names` | 同上 | 済 |
| `REGRESSION: kit in "dependencies" is a package.json-level failure, in ANY repository` | 同上 | 済 |
| `kit in "devDependencies" is fine, in any repository` | 同上 | 済 |
| `the dev-only rule text names the consequence, not just the rule` | 同上 | 済 |
| `the dotted preview edges are deliberately NOT rows in the graph` | 同上 | 済 |
| `REGRESSION: modelling a dotted edge would mislabel a real violation` | 同上 | 済 |
| `KNOWN LIMIT: from THIS copy, the dev-only IMPORT rules are shadowed by self-import` | 同上 | 済 |
| **（要追加）** `no InputService implementation exists in this repository` | 本実装時 | ソースを走査して `InputPort` を満たす Layer がここに無いことを assert |
| **（他 15 リポジトリ側）** `REGRESSION: kit may never be imported from shipped source` | 各リポジトリ | mc-sim には既にある |

---

## DN-02 起動は 1 秒。phase 別に計測し、超過を報告する

### plan.md §3.10

> 「ミニ平地ワールド + カメラ + レンダラ + 入力」を**1秒で起動**する糊。
> **全プレビューの開発体験がここの起動速度と安定性に依存する — 最も丁寧に作る部品**

### 参照実装の証跡 — 何と比べて 1 秒なのか

出荷セッションは意図的に、構造的に遅い。定数がそう言っている。

```
packages/app/application/main/session-loading-gates-state.ts:1
  const MIN_LOADING_SCREEN_DURATION_MS = 2500
packages/app/application/main/session-loading-gates-state.ts:2-5
  const INITIAL_FPS_GATE_TARGET = 120
  const INITIAL_FPS_GATE_TIMEOUT_MS = 8_000
  const INITIAL_FPS_GATE_POLL_MS = 100
  const INITIAL_FPS_GATE_STABLE_SAMPLES = 10
```

そしてローディング画面を隠す前にそのゲートを待つ。

```
packages/app/application/main/session-lifecycle-startup.ts:104-105
  yield* waitForInitialFrameRate(runtimeParams.hud.fpsElement)
  yield* loadingScreen.hide()
```

120fps を 100ms 間隔で 10 サンプル連続 = **最低 1 秒のポーリング**を、
**2.5 秒の最低表示時間**の上に積む。タイムアウトは 8 秒。

**ゲームとしては正しい。** プレイヤーがワールドを開くのは 1 日に数回で、
最初の可視フレームの前に安定したフレームレートが出ていることには待つ価値がある。

**プレビューには致命的である。** 開発者は 1 時間に何十回も relaunch する。
1 回 2.5 秒の強制待機は、仮説を確かめるか確かめないかの差になる。

### 新設計

`domain/boot-phase.ts`。7 phase、合計 1000ms。

| phase | 配分 (ms) | 所有リポジトリ |
| --- | ---: | --- |
| `resolve-options` | 5 | kit（純粋関数） |
| `world` | 400 | mc-worldgen |
| `simulation` | 120 | mc-sim |
| `renderer` | 300 | mc-render |
| `input` | 25 | mc-render |
| `modules` | 50 | 呼び出し側 |
| `first-frame` | 100 | 全員 |

判定の 2 つの決定事項:

- **phase が欠けていたら `withinBudget: false`。** これが無いと「何もしない起動」が最速になり、
  指標が「作業を速くする」ではなく「作業を削る」を推奨する。レンダラを attach しなかった起動は
  非常に速く、まったく無意味である
- **合計が範囲内でも、自分の配分を超えた phase は報告する。** phase の所有者は別々のリポジトリなので、
  内訳は「どのリポジトリを見に行くか」を教える。レンダラがたまたま速くて収まっている
  `world` の 3 倍超過は、ワールドが少し育った瞬間に破綻する

**配分は実測ではなく割り当てである。** Port の向こうに実装が無く、まだ 1 度も計測していない。
それでも今記録するのは、着手前に合意したバジェットは設計制約であり、
後から導出したバジェットは起きたことの記述にすぎないからである。

### 書くべき回帰テスト

| テスト名 | 場所 | 状態 |
| --- | --- | --- |
| `is one second — plan.md §3.10 「1秒で起動」` | `test/boot-phase.test.ts` | 済 |
| `the per-phase allowances sum to exactly the total` | 同上 | 済 |
| `REGRESSION: the whole budget is smaller than the reference session could ever be` | 同上 | 済（2500 との比較） |
| `REGRESSION: a missing phase is NOT "under budget" — it is unjudged` | 同上 | 済 |
| `reports a phase over ITS OWN allowance even when the total is fine` | 同上 | 済 |
| `sums duplicate timings for a phase rather than taking the first` | 同上 | 済 |
| `times every phase, in order, and judges the result` | `test/playground.test.ts` | 済 |
| `REGRESSION: a slow world phase is reported, not absorbed` | 同上 | 済 |
| **（要追加）** `a real boot with real Layers stays inside 1000ms` | 4 Port の実装が揃った時 | **これが本番の検証**。現状は fake の擬似コストで配分の算術だけを見ている |
| **（要追加）** `the budget holds on the slowest supported machine` | 同上 | CI マシンでの実測が要る |

---

## DN-03 `launch` は再入可能。取り残し fiber ゼロ

### plan.md §3.8（mc-sim の設計注意だが、kit こそ当事者）

> **ゲームループ・自動保存は `forkDaemon`**（スコープ非依存）+ 明示 `stop()`。
> 参照実装では2周目ワールドのデッドロック/やり残しfiberが最大級のバグ源だった。
> アプリスコープのシングルトンは**再入可能な初期化**を最初から

**プレビューハーネスはこの問題の最も鋭い形である。relaunch こそが仕事だから。**
ホットリロード、パラメータ変更、スクリーンショット取得 — すべて relaunch を伴う。
10 回目の relaunch が 1 回目と同一でないなら、プレビューはゲームについての証拠ではなく
ハーネスについての証拠になる。

### 参照実装の証跡

```
packages/game/application/game-loop.ts:133   const fiber = yield* Effect.forkDaemon(processFrames)
packages/game/application/game-loop.ts:228   const fiber = yield* Effect.forkDaemon(maintenanceLoop)
```

再入可能化のコメント（後付けであることが読み取れる）:

```
packages/game/application/game-loop.ts:141-148
  // Re-entrant: this service is an app-scoped singleton reused across worlds,
  // and its fibers are daemons that outlive session teardown. A best-effort
  // quit stop() can be cut off by its timeout, so rather than fail
  // "already running", tear down any lingering processing fiber and start
  // fresh ...
  // interruptFork (not interrupt): a previous session's fiber can be slow to
  // wind down after its scope closed — awaiting its exit here deadlocked the
  // next world's startup behind the loading screen.

packages/game/application/game-loop.ts:198-201
  // interruptFork (not interrupt): a torn-down session's maintenance fiber can
  // take arbitrarily long to acknowledge interruption, and awaiting it here
  // left the second world stuck on the loading screen forever
  // (save & quit -> load hang).
```

teardown がタイムアウト付きの best-effort であることの証跡:

```
packages/app/application/main/session-lifecycle-startup.ts:36-37
  () => runBestEffortQuitStep(gameLoopService.stop(), QUIT_CLEANUP_TIMEOUT)
packages/app/application/main/session-lifecycle-startup.ts:59-61
  Effect.addFinalizer(() =>
    runBestEffortQuitStep(Fiber.interrupt(autoSaveFiber).pipe(Effect.asVoid), QUIT_CLEANUP_TIMEOUT))
```

**teardown がタイムアウトで打ち切られうるということは、teardown が次の起動より後に終わりうる**
ということである。これが「late stop」問題（下の 4 番目のテスト）。

### 新設計 — mc-sim の `application/game-loop.ts` と同じ 4 規則

1. `Effect.forkDaemon`（`fork` ではない）
2. **detach してから interrupt。** 中断された `stop` が半端な状態を残さない。
   `Fiber.interruptFork`（`interrupt` ではない）で遅い fiber を待たない
3. `launch` は**再入可能**。「already running」で失敗しない。
   teardown が打ち切られうる以上、「already running」は呼び出し側が確実に脱出できない状態であり、
   ならば代わりに脱出させてやるのが唯一有用な答えである
4. **起動ごとに状態を新規作成**（キュー・フレームカウンタ・running フラグ・fiber スロット）。
   取り残された旧 daemon は自分の detach 済み状態に書くだけで、新しいプレビューを壊せない

加えて kit 固有:

5. **superseded なハンドルへの遅れた `stop()` は、現行プレビューを止めない。**
   `Ref` に入っている generation が自分と同一のときだけスロットをクリアする。
   これが無いと、1 つの relaunch バグの修正が別の relaunch バグの原因になる

### 書くべき回帰テスト

| テスト名 | 場所 | 状態 |
| --- | --- | --- |
| `REGRESSION: a second launch tears the first down — the second-world-load bug` | `test/playground.test.ts` | 済 |
| `REGRESSION: no fiber from the first launch survives to see a second launch frame` | 同上 | 済 |
| `REGRESSION: a late stop() on a superseded handle does not kill the live preview` | 同上 | 済 |
| `stop() is idempotent, so a best-effort teardown may run twice` | 同上 | 済 |
| `frames submitted after stop() are a silent no-op` | 同上 | 済 |
| `two Layer builds are two independent harnesses` | 同上 | 済 |
| `the service knows what it launched, and forgets it once stopped` | 同上 | 済 |
| **（要追加）** `no fiber survives teardown` | 本実装時 | `Fiber.roots` 相当で取り残し fiber を数える。現状は「旧ハンドルが新フレームを見ない」で代用しており、これは必要条件であって十分条件ではない |
| **（要追加）** `100 consecutive relaunches leak neither memory nor listeners` | 本実装時 | ホットリロードの実態に近い負荷 |

---

## DN-04 teardown は boot の逆順。input を最初に外す

### plan.md §3.9（mc-render の設計注意だが、順序を決めるのは kit）

> 入力は `window` にキー登録。モーダルは stopPropagation で遮蔽し、
> **Escapeキーの所有者はフレーム側の単一ハンドラ**

### なぜ順序が問題になるか

`window` に登録したリスナは、登録したオブジェクトより長生きする。
teardown が input を後回しにすると、**すでに detach 済みのレンダラに向かって
キーイベントが飛び込む窓**ができる。relaunch のクラッシュはここで起きる。

逆にワールドを最初に閉じると、まだ tick しているシミュレーションが
「もう存在しないワールド」に対して最後の自動保存を書きうる。

### 新設計

boot: `world → simulation → renderer → input → modules → first-frame`
teardown: `input → renderer → simulation → world`

**最初に外の世界との会話を止め、最後に永続するものを解放する。**

加えて、**どれかが失敗しても残り全部を実行する**（各ステップを `catchAllCause` で包む）。
途中で諦める best-effort teardown は、参照実装のタイムアウト付き quit ステップそのものであり、
それこそが再入可能性を必要にした原因だった。

### 書くべき回帰テスト

| テスト名 | 場所 | 状態 |
| --- | --- | --- |
| `touches the parent repositories in causal order` | `test/playground.test.ts` | 済 |
| `REGRESSION: input is detached FIRST, before the renderer it fires into` | 同上 | 済 |
| `REGRESSION: a second launch tears the first down` の event log | 同上 | 済（attach 4 → detach 4 → attach 4 の全列を assert） |
| **（要追加）** `a failing detach does not prevent the remaining teardown steps` | 本実装時 | 現状の実装はそうなっているが、fake が失敗しないのでテストが無い |

---

## DN-05 stage 全順序を解決しない（検査だけする）

### plan.md §2.3-3

> **stage 実行順序表は compose が唯一所有。** 各モジュールは順序制約（`after`）を宣言するだけで、
> 全順序は compose が解決する

### なぜ kit にとって危険なのか

ハーネスは実際に stage を並べて回す。`after` を見てトポロジカルソートすれば
「正しい順序」で回せるように見える。**ここが本リポジトリ最大の誘惑である。**

やると **compose と kit という 2 つの全順序解決器**ができ、食い違った瞬間に
「プレビューでは動くが出荷ゲームでは動かないモジュール」が生まれる。
16 リポジトリに分割した目的そのものを、分割を楽にするための道具が壊す。

### 新設計 — 検査は安全、解決は危険

| | やる | やらない |
| --- | --- | --- |
| stage を回す | 呼び出し側が並べた順のまま | `after` から順序を導出する |
| `after` を見る | 宣言順が制約と矛盾していないか**検査** | 矛盾を**解消** |
| 矛盾があったら | 警告して起動（`stageOrderWarnings` + `logWarning`） | 起動を拒否 |

検査器は順序を選ばないので、プレビューと出荷ゲームを食い違わせようがない。
言えるのは「あなたが書いた順序と、あなたが書いた制約は両立しない」という
完全にローカルな事実だけで、正解は依然として compose が持つ。

拒否ではなく警告なのは、**起動を拒否するとハーネス自身がデバッグ対象になる**から。

不在の stage を指す `after` は違反にしない（`mc-kernel/domain/frame.ts:46-54`）。
プレビューは定義上ゲームの部分集合なので、これがここでは常態である。

### 書くべき回帰テスト

| テスト名 | 場所 | 状態 |
| --- | --- | --- |
| `a correctly ordered set of stages produces no warnings` | `test/launch-options.test.ts` | 済 |
| `reports a stage declared BEFORE something it said it must follow` | 同上 | 済 |
| `catches an ordering violation that spans two modules` | 同上 | 済 |
| `an \`after\` naming an ABSENT stage is not a violation — kernel says the edge is absent` | 同上 | 済 |
| `a self-edge is ignored rather than reported as an impossible constraint` | 同上 | 済 |
| `a duplicate stage id resolves to its FIRST occurrence` | 同上 | 済 |
| `surfaces a contradiction between the caller order and the caller constraints` | `test/playground.test.ts` | 済（警告が出て、かつ起動していること） |
| `the kit does not export a topological sort` | `api-lock.md` / `pnpm api:check` | 済（公開シンボル一覧に順序解決器が現れないこと。API ロックの仕事であり、実装されている） |

---

## DN-06 deltaTime クランプを二重実装しない

### plan.md §3.8 / §3.4

> deltaTime は `min(max(0.001, raw), 0.05)` にクランプ、初回フレームは 0.016

### 参照実装の証跡

```
packages/game/application/game-loop.ts:116-119
  const rawDelta = lastTimestamp === 0
    ? FIRST_FRAME_DELTA_SECS
    : (timestamp - lastTimestamp) / 1000
  const deltaTime = DeltaTimeSecs.make(Math.min(Math.max(0.001, rawDelta), 0.05))

packages/core/domain/constants.ts:9
  export const FIRST_FRAME_DELTA_SECS: DeltaTimeSecs = DeltaTimeSecs.make(0.016)
```

plan.md は §3.4（mc-physics）でも同じ制約を挙げており、mc-sim の `docs/design-notes.md` DN-03 は
「両リポジトリで同値を維持すること」と書いている。**3 つ目を作らない。**

### 新設計

`PlaygroundHandle.submitFrame` は **タイムスタンプではなく delta を受け取り、クランプしない。**

食い違ったときの症状が悪質だからである。「プレビューをバックグラウンドにして戻したら
プレイヤーが床を抜けた」は**物理のバグに見える**。実際には kit のクランプが
mc-sim のクランプと 1 桁違っていた、というだけのことでも。

プレビューのフレーム駆動側（ブラウザなら `requestAnimationFrame`、テストならループ）が
mc-sim の `clampFrameDelta` で 1 回クランプして渡す。

**唯一複製しているのは定数 1 個**、`FIRST_FRAME_DELTA_SECS = 0.016`（boot の 1 フレーム目用）。
前フレームが無いので差が計算できず、値が要る。関数 1 個より定数 1 個のほうが
複製として遥かに小さく、`domain/kernel-vocabulary.ts` と同じ「mc-sim 公開時に削除」の
規律の下に置いてある。

### 書くべき回帰テスト

| テスト名 | 場所 | 状態 |
| --- | --- | --- |
| `does no clamping of its own — mc-sim owns the delta clamp` | `test/playground.test.ts` | 済（30 秒の delta を素通しすることを assert） |
| `the boot frame runs with the first-frame delta, not with zero` | 同上 | 済（0.016 をリテラルで） |
| **（要追加）** `FIRST_FRAME_DELTA_SECS equals mc-sim's` | mc-sim 公開時 | import して同値を assert、その後この定数を削除 |

---

## DN-07 E2E 環境の制約

### plan.md §3.10

> **移植元**: なし（新規）。**E2E環境の知見を流用**:
> Playwright は SwiftShader、ヘッドレスではポインタロック不可

これが本リポジトリの唯一の「移植元」である。コードではなく知見を移植する。

### 参照実装の証跡（すべて実測確認済み）

**1. SwiftShader が常用される。**

```
playwright.config.ts:3
  // Software rendering via SwiftShader is always used in e2e tests (no real GPU in headless mode).
playwright.config.ts:5
  process.env['PLAYWRIGHT_USE_SWIFTSHADER'] = '1'
playwright.config.ts:31-42
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--enable-webgl2',
  '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--no-sandbox',
  '--disable-setuid-sandbox', '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'
```

**2. 並列実行がフレームループを飢えさせ、合成キー入力を落とす。**

```
playwright.config.ts:11-15
  // One retry everywhere: with 2 local workers, parallel game instances can
  // starve the render loop and drop synthetic key presses across frame
  // boundaries — a retry absorbs that without masking deterministic failures.
  retries: 1,
  workers: process.env['CI'] ? 1 : 2,
```

同じ問題への別の対処が E2E ハーネス側にもある。

```
e2e/fixtures/game-page.ts:72-89
  // Under full-suite CPU contention the game loop runs at a fraction of 60 FPS,
  // and a synthetic `keyboard.press` is delivered relative to a frame boundary
  // that the input pipeline consumes non-deterministically ...
  // Real human-speed input never lands in this window, so robustness lives in
  // the harness rather than the game
```

**「頑健さはゲームではなくハーネスに置く」— これは本リポジトリ宛ての指示として読むべきである。**

**3. ヘッドレスではポインタロックが使えない。**

```
e2e/gameplay/player-controls.e2e.ts:208
  // Pointer lock is unavailable in headless mode, so there is no camera-delta to measure.
```

参照実装の InputService はポインタロック API を拒否する環境向けのフォールバックを持つ。

```
packages/presentation/input/input-service.ts:52
  const pointerLockFallbackRef = yield* Effect.sync(() => MutableRef.make(false))
packages/presentation/input/input-service.ts:255-266
  const featurePolicy = (document as Document & {
    featurePolicy?: { allowsFeature: (feature: string) => boolean } }).featurePolicy
  const pointerLockAllowed = typeof featurePolicy?.allowsFeature === 'function'
    ? featurePolicy.allowsFeature('pointer-lock') : true
  if (!pointerLockAllowed) { MutableRef.set(pointerLockFallbackRef, true); return }
packages/presentation/input/input-service.ts:112
  if (document.pointerLockElement instanceof HTMLCanvasElement
      || MutableRef.get(pointerLockFallbackRef)) { ... }
```

**4. 仮想入力パスが、ポインタロック無しでゲームを動かす手段である。**

```
packages/presentation/input/input-service.ts:305-318
  setVirtualKey(key, pressed) / pulseVirtualKey(key)
  addVirtualLookDelta(x, y)   / setVirtualLookActive(active)
packages/presentation/input/virtual-input-state.ts   （64 行、実装本体）
packages/presentation/input/input-service.ts:284
  MutableRef.get(pointerLockFallbackRef) || virtualInput.isLookActive()
```

**これは実在し、荷重を負っている引き継ぎである。** kit の E2E はこの経路で操作を与える。
そして**この surface は mc-render のものであり、kit のものではない**
（[responsibility.md](./responsibility.md) §3.1）。

**5. SwiftShader 下では skip すべき性能テストがある。**

```
e2e/gameplay/perf-target.e2e.ts:64-67
  test.skip(process.env['PLAYWRIGHT_USE_SWIFTSHADER'] === '1',
    '120 FPS validation requires non-SwiftShader rendering backend')
e2e/gameplay/perf-stage-baseline.e2e.ts:138-141
  test.skip(process.env['PLAYWRIGHT_USE_SWIFTSHADER'] === '1',
    'Stage perf baselines require non-SwiftShader rendering backend')
```

FPS 下限は SwiftShader 前提で較正されている。

```
e2e/gameplay/fps-threshold.e2e.ts:5-8
  // FPS thresholds: e2e tests always use SwiftShader software rendering ...
  const FPS_THRESHOLD = process.env['CI'] ? 10 : 12
e2e/gameplay/new-world-regression.e2e.ts:22-27
  // Sustained-FPS floors are owned by fps-threshold.e2e.ts with
  // environment-calibrated thresholds (CI 10 / local 12 under SwiftShader) —
  // the floor of 20 that used to live here was STRICTER than the platform's own
  // calibrated floor ... the historical flake source.
  const STARTUP_FPS_FLOOR = 1
```

### kit にとっての帰結

| 知見 | kit の設計への反映 |
| --- | --- |
| ヘッドレスに GPU が無い | **起動バジェットを E2E で検証しない。** SwiftShader 下の 1 秒は実機の 1 秒ではない。バジェットは Node の純粋関数テストと、実機での手動計測で見る |
| ポインタロック不可 | ハーネスはポインタロックを**要求しない**。`InputPort` は `attach`/`detach` だけで、ロックの有無を知らない |
| 仮想入力が操作手段 | kit の E2E は mc-render の仮想入力経路で操作する。kit 自身は入力を作らない |
| 並列実行でキー入力が落ちる | kit の E2E は **1 worker** で走らせる。ハーネスの検証にフレーム飢餓のノイズを混ぜない |
| FPS 下限は環境較正が要る | kit の E2E に FPS アサーションを**置かない**。フレームレートは mc-render / mc-compose の関心事 |
| 「頑健さはハーネスに置く」 | 4 つの重い surface を Port にした理由そのもの。順序・後始末・再入可能性は Node で検証する |

### 書くべき回帰テスト

| テスト名 | 場所 | 状態 |
| --- | --- | --- |
| **（要追加）** `the minimal E2E boots, moves, and screenshots` | plan.md §3.10 の検証。**完了条件** | E2E 一式が未実装（[testing.md](./testing.md) §2） |
| **（要追加）** `the E2E drives input through mc-render's virtual input, never through pointer lock` | 同上 | |
| **（要追加）** `playwright.config.ts runs with 1 worker and SwiftShader args` | E2E 導入時 | 参照実装の `:31-42` を移植 |
| **（要追加）** `no FPS assertion appears in this repository's E2E` | E2E 導入時 | ソース走査 |
| `does no clamping of its own` / `touches the parent repositories in causal order` 他 | `test/playground.test.ts` | 済（Node で全部検証していること自体がこの DN の実践） |

---

## DN-08 カメラ姿勢は運ぶだけ。書き戻す口を作らない

### plan.md §5.1-2 / §3.8

> **カメラ所有権**: 参照実装はTHREEカメラが正でシミュレーションが描画から視線を読む逆転構造だった
> （「camera.position を読むな matrixWorld を使え」という慢性gotchaの根源）。
> 新実装は sim が姿勢を所有し、THREEカメラはミラー

### なぜ kit が当事者なのか

**kit は sim と render のちょうど間に立つ。** 逆転構造を復活させる最短経路がここにある。
「プレビューでカメラをちょっと動かしたい」という要求は必ず来るし、
`setCameraPose` を 1 つ足せば叶う。叶えた瞬間に mc-sim の DN-01 が無効になる。

参照実装が払った代償（13 箇所の読み戻し、`.position` が stale になる窓）は
`mc-sim/docs/design-notes.md` DN-01 に全リストがある。

### 新設計

- `SimulationPort.cameraPose` は `Effect<CameraPoseSnapshot>` の**読み取りのみ**。setter は無い
- `RendererPort.renderFrame(dt, pose)` は姿勢を**引数で受ける**。
  ミラーの向きがシグネチャに現れ、レンダラが姿勢を返す引数位置が存在しない
- `PlaygroundHandle.cameraPose` も読み取りのみ

プレビューがカメラを動かしたければ、mc-sim の `PlayerService.look` を叩く。
それが姿勢を変える唯一の口である。

### 書くべき回帰テスト

| テスト名 | 場所 | 状態 |
| --- | --- | --- |
| `the camera pose is read from the simulation, and cannot be written back` | `test/playground.test.ts` | 済（`PlaygroundHandle` のキー集合を固定。`setCameraPose` はまずここに現れる） |
| **（要追加）** `no Port accepts a CameraPoseSnapshot as input except the renderer` | 本実装時 | ソース走査。`renderFrame` だけが受け取ってよい |
| **（mc-render 側）** `a render-side weapon bob does not perturb the pose the simulation reports` | mc-render | mc-sim の DN-01 が要求 |

---

## DN-09 `Date.now()` / `performance.now()` を使わない

### plan.md §4.3 / §5.1-3

> クロックPort — 決定論・fast-forward の要。`Date.now()` 直接参照禁止

### なぜ kit で特に危ないのか

**本リポジトリは起動時間を測るのが仕事である。** 起動時間を測るために手が伸びる関数は
`performance.now()` であり、それは禁止されている 3 つのうちの 1 つである。

`domain/boot-phase.ts` は `MonotonicTimeSecs`（`ClockPort` 由来、秒）を受け取って
ミリ秒に変換するだけで、自分では時刻を読まない。読むのは
`application/playground.ts` の `phase` ヘルパで、それも注入された `ClockPort` から読む。

**その結果、起動バジェットのテストが Node で決定論的に走る**（`test/playground.test.ts` の
fake clock は Port が「作業した」ぶんだけ進む `Ref`）。壁時計を読んでいたら、
バジェットのテストは CI マシンの負荷で落ちるフレーキーテストになっていた。

### 強制の実体

`scripts/check-dependency-whitelist.ts` の `findBannedTimeSources`
（`Date.now()` / `new Date()` / `performance.now()` の 3 つ）。**oxlint.json ではない** —
oxlint 0.12 は `no-restricted-syntax` も `no-restricted-properties` も実装しておらず、
`no-restricted-globals` は一覧に出るが実装されていない（mc-kernel で 0.12.0 に対し実測確認済み）。
oxlint が該当ルールを実装したら oxlint.json へ移す。

Clock Port の実装アダプタだけが `mc-kernel-allow-time-source` コメントで除外される。
**そのアダプタは本リポジトリには無い**（kit は `ClockPort` を要求する側）。

### 書くべき回帰テスト

| テスト名 | 場所 | 状態 |
| --- | --- | --- |
| `catches all three raw clock reads, with line numbers` | `test/check-dependency-whitelist.test.ts` | 済 |
| `ignores the same text inside a comment or a string` | 同上 | 済 |
| `the escape hatch exempts exactly the line that carries it` | 同上 | 済 |
| `clamps a backwards interval to zero rather than reporting a negative boot` | `test/boot-phase.test.ts` | 済 |
| **（要追加）** `no escape-hatch comment exists in this repository` | 本実装時 | kit に正当な実クロック読みは無い。1 行でもあれば設計が漏れている |
