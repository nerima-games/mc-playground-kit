# 移植元と実測 LOC

## 0. 結論を先に: 移植元は無い

plan.md §3.10:

> **移植元**: なし（新規）。E2E環境の知見を流用:
> Playwright は SwiftShader、ヘッドレスではポインタロック不可

**参照実装に mc-playground-kit に相当するものは存在しない。** 15 リポジトリのうち
移植元が「なし」なのはここだけである。理由は明快で、参照実装は単一リポジトリだったので
「複数のプレビューを共通の方法で起動する」という問題自体が発生しなかった。

したがって本文書がやることは 3 つ。

1. **移植元が無いことを明言する**（§1）
2. **最も近縁な参照実装コードを、実測 LOC 付きで列挙する**（§2）。移植はしないが、
   何を作らないかを決めるために読む価値がある
3. **引き継ぐ唯一の資産である E2E 環境の知見を記録する**（§3）

## 計測条件

明示しないと再現できないため。

```console
# production LOC: .ts のうち *.test.ts / *.spec.ts を除く（node_modules / dist は対象外）
$ find <dir> -name '*.ts' -not -name '*.test.ts' -not -name '*.spec.ts' | xargs wc -l
```

`packages/*/test/` 配下のヘルパ（`*-test-utils.ts` 等）は `.test.ts` ではないため
**production 側に計上される**。参照実装はこのファイル名規約なので、数値を読むときは注意すること。
**以下の LOC はすべて本文書作成時に `wc -l` で実測した値**であり、plan.md の見積りではない。

## 1. 移植しないもの（= ほぼ全部）

| 参照実装の要素 | 移植しない理由 |
| --- | --- |
| `session-bootstrap-*`（16 ファイル / 1,051 LOC） | **出荷セッションであってプレビューではない。** §2.1 で違いを述べる |
| `session-lifecycle-*` / `session-control` / `session-loading-gates-*`（10 ファイル / 776 LOC） | セッションライフサイクル（タイトル⇄ゲーム）は mc-compose（plan.md §3.15） |
| `packages/app/application/main/layers/`（66 ファイル / 918 LOC） | Layer 合成は mc-compose が唯一所有（plan.md §2.3-3 / §3.15）。plan.md §3.15 の「配線(918 LOC相当)」は**この 918 と一致する** —— ただし一致するのは `layers/` に限った読み方のときだけである。§1.1 |
| `qa-api-*`（14 ファイル） | QA/デバッグ API は mc-compose（plan.md §3.15） |
| `packages/presentation/input/`（681 LOC） | **実行時入力は mc-render が所有**（plan.md §2.3-2）。§3.3 で詳述 |
| `e2e/` のテスト本体（23 ファイル / 2,875 LOC） | 参照実装の E2E は mc-compose が移植する（plan.md §3.15）。plan.md の「64 本」は公称値で、実測は **70 本**（23 ファイル）。§3.6 |
| `e2e/helpers/` `e2e/fixtures/`（6 ファイル / 558 LOC） | ここだけは**部分的に参考にする**。§3.4 |

### 1.1 「918 LOC相当」の読み方 —— mc-compose の判定と食い違わせないこと

本表の 918 は再現できる実測値である
（`packages/app/application/main/layers/` の 66 ファイルがちょうど 918 LOC）。
その意味で「plan.md §3.15 の 918 はこの実測値と一致する」は正しい。

しかし mc-compose の
[porting.md](https://github.com/nerima-games/mc-compose/blob/main/docs/porting.md) §0.1 は、
同じ 918 を「**22 倍の過小評価**」と判定している。**両方とも正しい。読み方が違うだけである。**

| plan.md §3.15 の「`packages/app` の配線(918 LOC相当)」の読み方 | 実測 | 判定 |
| --- | ---: | --- |
| 「Layer 合成コードは何行か」（`main/layers/`、66 ファイル） | **918** | plan.md は**正しい** |
| 「`packages/app/application/` から出ていく総量は何行か」 | **20,737** | plan.md は **22 倍の過小評価** |

本リポジトリが 918 を使うのは前者の意味 —— **「移植しないもの」の輪郭を描くため**である。
mc-compose が 20,737 を使うのは後者の意味 —— **自分が引き取る総量を見積もるため**である。
どちらの数字も同じ 1 本のコマンドで再現できる:

```console
$ cd <reference-impl>
$ find packages/app/application/main/layers -name '*.ts' -not -name '*.test.ts' | xargs wc -l | tail -1
   918 total
$ find packages/app/application -name '*.ts' -not -name '*.test.ts' | xargs wc -l | tail -1
 20737 total
```

**plan.md が誤っているのは数値ではなくスコープの表示である。**
「`packages/app` の配線」と書きながら測っているのは `main/layers/` だけで、
その差 19,819 LOC が本計画そのものになった（mc-compose の porting.md §0.1）。

## 2. 最も近縁なコード（実測）

### 2.1 セッション起動 — `packages/app/application/main/`

| 区分 | production LOC | ファイル数 |
| --- | ---: | ---: |
| `main/` 全体 | **7,948** | 175 |
| うち `session-bootstrap*` | **1,051** | 16 |
| うち `session-lifecycle*` + `session-control` + `session.ts` + `session-disposal` + `session-loading-gates*` | **776** | 10 |
| うち `layers/` | **918** | 66 |
| `boot.ts` | 88 | 1 |
| `src/main.ts`（リポジトリルート） | 201 | 1 |

`session-bootstrap*` の内訳（実測）:

| ファイル | LOC |
| --- | ---: |
| `session-bootstrap-orchestration.ts` | **231** |
| `session-bootstrap-world-orchestration.ts` | 140 |
| `session-bootstrap-world-presentation-state.ts` | 101 |
| `session-bootstrap-world-presentation.ts` | 77 |
| `session-bootstrap-world-deps.ts` | 74 |
| `session-bootstrap-scene.ts` | 65 |
| `session-bootstrap-runtime-params.ts` | 64 |
| `session-bootstrap-world-state.ts` | 48 |
| `session-bootstrap-deps.ts` | 43 |
| `session-bootstrap-runtime.ts` | 37 |
| `session-bootstrap-world-presentation-view.ts` | 35 |
| `session-bootstrap-runtime-deps.ts` | 30 |
| `session-bootstrap-runtime-services.ts` | 29 |
| `session-bootstrap-world-presentation-time.ts` | 28 |
| `session-bootstrap-runtime-state.ts` | 26 |
| `session-bootstrap-world-presentation-player.ts` | 23 |
| **合計** | **1,051** |

**中心は `session-bootstrap-orchestration.ts`（231 行）である。** 読むべきなのは冒頭。

```
packages/app/application/main/session-bootstrap-orchestration.ts:27-54
  const { rendering, world, gameplay, presentation, inventory, entity, multiplayer } = services
  const { sceneService, cameraService, worldRendererService, particleSystem } = rendering
  const { chunkManagerService, biomeService, cropGrowthService, netherService } = world
  const { gameState, timeService, weatherService, gameModeService } = gameplay
  const { debugOverlay, screenshotKey, blockHighlight, crosshair, controlsHint,
          hotbarRenderer, chatPanel, connectionPanel, playerListPanel } = presentation
  const { recipeService, inventoryService, equipmentService, chestService, furnaceService } = inventory
  const { playerCameraState, healthService, hungerService, xpService,
          statisticsService, achievementService, entityManager, parkedVehicleService } = entity
  const { canvas, renderer, perfHud, settingsService, soundManager, musicManager, terrainPool } = bootCtx
```

**7 グループから約 40 個のサービスを分解代入している。** そこから scene → world →
mods → lighting → runtime と積み上げ、最後に 7 個の値を返す。

これは出荷ゲームのセッションとして**正しい**。本物のセッションはこれら全部を必要とする。

**kit がやるのは同じことの縮小版ではない。** kit は 4 つの Port しか知らない。
ポーズメニューも実績も村もネザーも mods もマルチプレイヤーのシード交渉も、
「小さくする」のではなく**最初から知らない**。231 行 + 40 サービスと、
本リポジトリの `application/playground.ts` の差はここから来ている。

**したがって移植ではない。読んで「作らないもの」を決めるための資料である。**

### 2.2 フレームループ — 移植ではなく規約の共有

`packages/game/application/game-loop.ts`（260 LOC）は **mc-sim の移植元**であり、
kit の移植元ではない。ただし本リポジトリの `application/playground.ts` は
そこから引き出された 4 規則（`forkDaemon` / detach してから `interruptFork` / 再入可能な
`start` / 世代ごとの状態）を同型で実装している。証跡は
[design-notes.md](./design-notes.md) DN-03。

**コードは共有せず、規約を共有する。** 2 つのリポジトリが同じライフサイクル問題を
2 通りに解くのが、次の 2 周目デッドロックの入り口だからである。

### 2.3 起動時間の制御 — 参照実装は逆をやっている

参照実装に「起動バジェット」は無い。あるのは正反対のもので、
**十分に遅くなるまで待つ**仕組みである。

```
packages/app/application/main/session-loading-gates-state.ts:1-5
  const MIN_LOADING_SCREEN_DURATION_MS = 2500
  const INITIAL_FPS_GATE_TARGET = 120
  const INITIAL_FPS_GATE_TIMEOUT_MS = 8_000
  const INITIAL_FPS_GATE_POLL_MS = 100
  const INITIAL_FPS_GATE_STABLE_SAMPLES = 10
```

| ファイル | LOC | 内容 |
| --- | ---: | --- |
| `session-loading-gates-terrain.ts` | 119 | 地形ロード待ち |
| `session-loading-gates-state.ts` | 31 | 上記の定数群 |
| `session-loading-gates-polling.ts` | 24 | ポーリング汎用 |
| `session-loading-gates.ts` | 24 | `waitForInitialFrameRate` |

**移植しない。** ゲームには正しく、プレビューには致命的である
（[design-notes.md](./design-notes.md) DN-02 に全文）。

## 3. 引き継ぐ唯一の資産 — E2E 環境の知見

plan.md §3.10 が名指しした「E2E環境の知見」。**コードではなく制約の知識**である。
全証跡は [design-notes.md](./design-notes.md) DN-07 にあり、ここでは要点と数値を置く。

### 3.1 Playwright の設定（`playwright.config.ts`、62 行）

| 行 | 内容 |
| ---: | --- |
| 3 | `// Software rendering via SwiftShader is always used in e2e tests (no real GPU in headless mode).` |
| 5 | `process.env['PLAYWRIGHT_USE_SWIFTSHADER'] = '1'` |
| 11-15 | `retries: 1` — 並列ゲームインスタンスがレンダーループを飢えさせ、合成キー入力をフレーム境界で落とすため |
| 15 | `workers: process.env['CI'] ? 1 : 2` |
| 31-42 | `--use-gl=angle` / `--use-angle=swiftshader` / `--enable-unsafe-swiftshader` ほか 8 個 |
| 54-61 | `webServer`: `VITE_E2E_DISABLE_HMR=1` で dev サーバを 5180 に立てる |

### 3.2 ポインタロックはヘッドレスで使えない

```
e2e/gameplay/player-controls.e2e.ts:208
  // Pointer lock is unavailable in headless mode, so there is no camera-delta to measure.
```

参照実装の InputService は API を拒否する環境向けのフォールバックを持つ:

```
packages/presentation/input/input-service.ts:52       pointerLockFallbackRef
packages/presentation/input/input-service.ts:255-266  featurePolicy.allowsFeature('pointer-lock')
packages/presentation/input/input-service.ts:112      フォールバック時もマウス移動を受け付ける分岐
```

### 3.3 仮想入力パス — 実在し、荷重を負っている引き継ぎ

`packages/presentation/input/` の実測（合計 **681** LOC。plan.md §3.9 の「681 LOC」と完全一致）:

| ファイル | production LOC |
| --- | ---: |
| `input-service.ts` | **337** |
| `gamepad-input-state.ts` | 152 |
| `input-service-test-utils.ts` | 75（`.test.ts` ではないので production 計上） |
| `virtual-input-state.ts` | **64** |
| `screenshot-service.ts` | 50 |
| `index.ts` | 3 |
| **合計** | **681** |

仮想入力の公開面:

```
packages/presentation/input/input-service.ts:305-318
  setVirtualKey(key, pressed)   / pulseVirtualKey(key)
  addVirtualLookDelta(x, y)     / setVirtualLookActive(active)
packages/presentation/input/input-service.ts:284
  MutableRef.get(pointerLockFallbackRef) || virtualInput.isLookActive()
packages/presentation/input/virtual-input-state.ts   （64 行、実装本体）
```

**ヘッドレスプレビューがゲームを操作する手段はこれである。** ポインタロックが無い以上、
視点移動を与える方法が他に無い。

**そして 681 LOC はすべて mc-render へ行く。kit には 1 行も来ない**（plan.md §2.3-2 / §3.9）。
kit の E2E はこの surface を**利用する**が、**所有しない**
（[responsibility.md](./responsibility.md) §3.1）。

### 3.4 E2E ハーネスの構造（部分的に参考にする）

| ファイル | LOC | kit にとって |
| --- | ---: | --- |
| `e2e/helpers/db-helpers.ts` | 174 | 参考にしない（IndexedDB の後始末は mc-save / mc-compose） |
| `e2e/helpers/wait-helpers.ts` | 140 | **参考にする**。`waitForGameReady` / `getFpsValue` の待ち合わせ方 |
| `e2e/fixtures/game-page.ts` | 116 | **最も参考にする**。§3.5 |
| `e2e/helpers/touch-helpers.ts` | 78 | 参考にしない（タッチは mc-render） |
| `e2e/helpers/console-monitor.ts` | 35 | **参考にする**。致命エラーの検出 |
| `e2e/helpers/qa-globals.d.ts` | 15 | 参考にしない（QA API は mc-compose） |
| **合計** | **558** | |

### 3.5 「頑健さはゲームではなくハーネスに置く」

`e2e/fixtures/game-page.ts:72-89` のコメントは、本リポジトリ宛ての指示として読める。

```
// Under full-suite CPU contention the game loop runs at a fraction of 60 FPS,
// and a synthetic `keyboard.press` is delivered relative to a frame boundary
// that the input pipeline consumes non-deterministically: the just-pressed key
// is sometimes not observed for many slow frames, or a slow frame followed by
// the next one both toggle it (open then immediately close). Real human-speed
// input never lands in this window, so robustness lives in the harness rather
// than the game: re-read the overlay state, and press the toggle only while it
// is not yet in the desired state.
```

**ゲーム側を防御的にするのではなく、ハーネス側が観測してリトライする。**
本リポジトリが 4 つの重い surface を Port にし、順序・後始末・再入可能性を
Node の決定論テストで検証しているのは、同じ方針の別の現れである。

### 3.6 参照実装の E2E 規模（実測と公称の差）

| 出典 | 数 |
| --- | --- |
| plan.md 冒頭 / §3.15 | 「E2E 64本」 |
| `docs/reference/shipping-readiness-2026-07-10.md:14` | 「64 passed / 0 failed / 2 skipped (2026-07-10 baseline)」= 実行 66 |
| 実測 `find e2e -name '*.e2e.ts'` | **23 ファイル** |
| 実測 `grep -c 'test('`（行頭） | **70 箇所**（行頭以外を含めると 71） |

**70/71 と 66 の差は 4〜5 本。** 内訳の候補は
`e2e/gameplay/perf-target.e2e.ts:64-67` と `e2e/gameplay/perf-stage-baseline.e2e.ts:138-141` の
`test.skip`（= 2 skipped の正体）、および grep がコメント/文字列を拾った分。
**この差分は mc-compose 側で決着済みである** ——
[porting.md](https://github.com/nerima-games/mc-compose/blob/main/docs/porting.md) §0 が
`grep -rhcE "(^|[^.a-zA-Z])test\(" e2e --include='*.e2e.ts'` で **70** を確定させ、
「plan.md の 64 本と食い違う（+6）」と記録している。
**移植計画に使う数字は 70 本 / 23 ファイルである。** mc-sim の `docs/porting.md` §6 も同じ結論。
上表に残した 66 や 71 は、その 70 がどう揺れうるかの記録であって、採用値ではない。

参照実装の E2E 総量: **23 ファイル / 2,875 LOC**（`.e2e.ts` のみ）、
ヘルパと fixture を含めて **3,469 LOC**。

## 4. 本リポジトリの現在の規模

比較のために。

| ファイル | LOC |
| --- | ---: |
| `application/playground.ts` | 467 |
| `domain/launch-options.ts` | 337 |
| `domain/boot-phase.ts` | 288 |
| `domain/kernel-vocabulary.ts` | 225（暫定ミラー。kernel 公開時に削除） |
| `application/preview-ports.ts` | 185 |
| `index.ts` | 51 |
| **production 合計** | **1,553** |
| `test/` 4 ファイル | **1,580**（91 テスト） |

**うち大半がコメントである。** 実行される行だけ数えれば桁が 1 つ落ちる。
参照実装のセッション起動 1,051 行（40 サービス）と本リポジトリの `playground.ts` 467 行を
並べて「同じくらいの規模」と読んではいけない。**本リポジトリが知っているのは 4 つの Port だけ**で、
残りはすべて「なぜそうしないか」の記録である（§2.1）。
