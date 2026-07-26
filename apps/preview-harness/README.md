# apps/preview-harness

mc-playground-kit の**内蔵プレビュー**。plan.md §6 Step 2 の
「内蔵プレビューが操作可能」に対する回答であり、
docs/testing.md の「自身の最小 E2E」の**うち書ける半分**である。

plan.md §2.3-4「プレビューは検証対象と同居する」に従い、
**このリポジトリの中の dev アプリケーション**である。
パッケージではない。`index.ts` からは公開されない。利用側から import できない。

```console
$ pnpm preview                                              # 対話モード
$ pnpm preview --help                                       # キー割り当てとオプション
$ pnpm preview --list                                       # シナリオ一覧
$ pnpm preview --stats                                      # 数値レポート（発見はここ）
$ pnpm preview --scenario slow-world --at 2 --once --ascii  # ブートバジェットの内訳
$ pnpm preview --scenario stale-stop --at 6 --view ledger --once --ascii
```

`pnpm verify` はこれを実行しない。ただし `pnpm typecheck`（`tsconfig.preview.json`）と
`pnpm lint` と `pnpm check:deps` の対象には**入っている**。

## スクリーンショットの半分が無い理由

docs/testing.md はこのリポジトリのプレビューを
**「起動 → 操作 → スクリーンショット」**と定めている。
**前 2 つはここにある。3 つ目は今日書けない。** 理由は労力ではなく、4 つある。

1. **本物の Port Layer が無い。** `application/preview-ports.ts` は
   4 つの `Context.Tag` とサービス型だけで、`Layer.succeed` が**意図的に 1 つも無い**
   （その理由はファイル冒頭にある —— パッケージが fake を出荷すると、
   利用側がその上にプレビューを建てられてしまい、何も描かない renderer の上に
   立ったプレビューは「通る」）。本物には mc-worldgen / mc-sim / mc-render の
   publish と pin が要る（plan.md §6 Step 3）。**何も publish されていない。**
2. **ブラウザが要る。** スクリーンショットはピクセルの写真であり、
   mc-render は THREE.js も `lib.DOM` も出荷していない。
3. **`@playwright/test` が組織のどのリポジトリの依存にも入っていない。**
   足すのは package.json の 1 行ではなく、CI 実行時間についての決定である。
4. **ベースライン方針が無い。** 「同じ絵とは何か」の合意が無いスクリーンショットテストは
   フォント更新で落ちるテストである。plan.md §3.10 は Playwright が SwiftShader 上で
   動くと記録しているので、ベースラインを開発機から取ることもできない。

## それでも今日測れるもの ——「1 秒で確実に起動する」

plan.md §3.10 は kit を「**最も丁寧に作る**」部分と呼ぶ。
理由は他の全リポジトリのプレビュー起動がここに乗るからで、
成り立たなければならない性質は**約 1 秒で、確実に起動する**ことである。

**それは今日測れる。しかも Port が注入されているからこそ測れる。**

このアプリは 4 つの fake Port と 1 つの `ClockPort` をプログラムし、
起動し、操作し、破棄し、再起動して、**ブートバジェットをフェーズ別に**出す。

```
                phase                   took    budget  share
                resolve-options       0.0 ms      5 ms  ..................
                world               900.0 ms    400 ms  ##################  +500.0 ms
                simulation           40.0 ms    120 ms  ######............
                renderer            120.0 ms    300 ms  #######...........
                input                 0.0 ms     25 ms  ..................
                modules               0.0 ms     50 ms  ..................
                first-frame           0.0 ms    100 ms  ..................

total           1060.0 ms of 1000 ms   OVER
per-phase sum   1000 ms   equals the total, so an overrun must be paid for by an underrun
verdict         OVER boot 1060.0ms / 1000ms budget over=[world+500.0ms]
```

（`pnpm preview --scenario slow-world --at 2 --once --ascii`）

**壁時計で測ったブートバジェットはベンチマークである。**
負荷のかかった CI で落ちるベンチマークは削除される。
このアプリが出すミリ秒はすべて fixture がプログラムした `ClockPort` 由来なので、
**ノート PC でも CI でも同じ数字になる**。
`Date.now()` / `new Date()` / `performance.now()` はどこにも無く、
`mc-kernel-allow-time-source` エスケープハッチも使っていない。

## 4 つのビュー

| ビュー | キー | 何が見えるか |
| --- | --- | --- |
| `boot` | `1` | 7 フェーズの所要時間 vs 予算、判定、できあがったプレビュー |
| `ledger` | `2` | **Port への全呼び出しを順番に。** teardown の逆順もここで見る |
| `stages` | `3` | 宣言順チェッカの矛盾報告と、モジュール登録の評価回数 |
| `options` | `4` | `normalizeLaunchOptions` の既定値と `Supplied<T>` の意味、予算表 |

## 見つけたもの

`--stats` が全部を数値で出す。各項目に file:line と再現コマンドが付いている。

| # | 内容 | 場所 |
| --- | --- | --- |
| KIT-1 | **世代交代した handle の `stop()` が、生きているプレビューの Port を落とす** | `application/playground.ts:389-393` |
| KIT-2 | **1 回の launch でモジュールの `frameStages` が 2 回評価される** | `application/playground.ts:344`, `:352` |
| KIT-3 | `elapsedMillis` が非有限入力で throw する（doc は負値の話しかしていない） | `domain/boot-phase.ts:99-100` |

### KIT-1 —— 一番重いもの

`application/playground.ts:397-402` は**まさにこれ**をコメント付きで守っている:

```ts
// Only clear the shared slots if THIS generation is still the current
// one. A relaunch has already replaced it, and a late stop() on the old
// handle must not unregister the new preview.
const installed = yield* Ref.get(generationRef)
if (Option.isSome(installed) && installed.value === generation) {
```

**ガードは正しい。守っている対象が 2 つ足りない。**
その 2 行上（`:389-393`）の 4 つの Port teardown は無条件に走り、
`services`（`:312-318`）は同じ Layer から解決された**同じオブジェクト**である。

```console
$ pnpm preview --scenario stale-stop --at 6 --view ledger --once --ascii

                  13     0.0 ms  input       detach            <- 再起動自身の正当な teardown
                  14     0.0 ms  renderer    detach
                  15     0.0 ms  simulation  stop
                  16     0.0 ms  world       closeWorld
                  17     0.0 ms  world       openFlatWorld     <- 2 つ目のプレビューが起動
                  18     0.0 ms  simulation  spawn
                  19     0.0 ms  renderer    attach
                  20     0.0 ms  input       attach
                  21     0.0 ms  simulation  tick
                  22     0.0 ms  renderer    renderFrame
                  23     0.0 ms  input       detach            <- fired by a SUPERSEDED handle, against the LIVE ports
                  24     0.0 ms  renderer    detach            <- fired by a SUPERSEDED handle, against the LIVE ports
                  25     0.0 ms  simulation  stop              <- fired by a SUPERSEDED handle, against the LIVE ports
                  26     0.0 ms  world       closeWorld        <- fired by a SUPERSEDED handle, against the LIVE ports
                  27     0.0 ms  simulation  tick              <- 閉じたワールドへフレームが流れ続ける
                  28     0.0 ms  renderer    renderFrame
```

teardown バグとして**最悪の形**である。生きているプレビューの入力リスナは解除され、
renderer は detach され、simulation は停止し、world は閉じられているのに、
`isRunning` は `true`、`playground.current` は `Some`、`framesRendered` は増え続ける。

**これはこのリポジトリにとって仮定の話ではない。**
`stop` が best-effort で `launch` が再入可能である理由そのもの（`playground.ts:120-127`）が、
「参照実装の quit ステップはタイムアウトで打ち切られ、**次のワールドが始まったあとに完了しうる**」
だからである。上のシーケンスがまさにそれである。

`test/playground.test.ts:485` の名前は
`REGRESSION: a late stop() on a superseded handle does not kill the live preview` で、
**正しいことについてのテストである**。ただし `liveHandle.isRunning`（`:498`）と
`playground.current`（`:499`）しか見ておらず、
それはガードが既に守っている 2 つのフィールドそのものである。
`fakes.events` を見ていない。4 つの呼び出しはそこに出る。

`:506` の `two Layer builds are two independent harnesses` にも同じ死角がある
（`left.stop` が `right` の使っている Port を detach するが、`right.isRunning` しか見ていない）。

### KIT-2

`playground.ts:344` が `phase('modules', flattenStages(...))` を走らせ、
`:352` が `stageOrderViolations(...)` を走らせる。後者は内部でもう一度
`flattenStages` を呼ぶ（`launch-options.ts:333`）。帰結は 2 つ:

1. **`modules` フェーズが過少報告する。** 登録コストの半分が `phase()` の外に落ち、
   `playground.ts:322` の「Every phase in `BOOT_PHASE_ORDER` goes through here」に反する。
   **ブートバジェットを製品にしているリポジトリで。**
2. **`stageOrderWarnings` が、pump が走らせないステージについての警告になる。**
   登録 Effect が冪等でないモジュール（`Ref.make` を中に持つ —— まさに
   `frameStages` が Effect になった理由の形）は、2 回目に**別の**
   `StageRegistration` 集合を返す。

テストスイートのモジュールはすべて `Effect.succeed([...])` で、冪等かつ無料である
（`test/playground.test.ts:132, :289, :536, :559` と `test/launch-options.test.ts:33-35`）。
**構造上、二重評価が見えない。**

## 本物の Layer ができたとき

このアプリが差し込み口になる。`apps/preview-harness/harness.ts` の fixture が、
4 つの Layer が満たすべき形そのものである。

## 依存

**このリポジトリ自身のモジュールと `effect` だけ。**
`effect` は既に `dependencies` にある。org パッケージも新規 npm 依存も無い。
`apps` は `SCAN_ROOTS` に入っているので、import は `domain/` と同じゲートを通る。

fake Port が `application/preview-ports.ts` ではなく**ここ**にあるのは意図である
（同ファイル冒頭が理由を書いている）。dev アプリの中なら、何も import できない。

## ファイル

```
main.ts        エントリ、キー処理、--once / --stats / --list
options.ts     CLI パーサ（純粋）
script.ts      シナリオ定義（データのみ。何も実行しない）
harness.ts     4 つの fake Port + プログラム可能な ClockPort の上に本物の Playground を立てる
views.ts       4 つのビュー（純粋。HarnessView と Style だけの関数）
probes.ts      --stats の数値レポート
style.ts       色と整形（純粋）
terminal.ts    このアプリで唯一の非純粋モジュール（Node の stdio）
```
