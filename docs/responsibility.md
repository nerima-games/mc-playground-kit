# 責務

出典: plan.md §3.10。以下は原文の責務記述を、スコープ / 非スコープの境界まで展開したもの。

## 1. 責務（plan.md §3.10 原文）

> プレビュー用共通ハーネス。「ミニ平地ワールド + カメラ + レンダラ + 入力」を1秒で起動する糊。
> **全プレビューの開発体験がここの起動速度と安定性に依存する — 最も丁寧に作る部品**

一言でいえば「**他の 15 リポジトリのプレビューが、同じ方法で、速く、確実に立ち上がる場所**」。

「糊」という語が正確である。糊は接着するものであって、接着される部品ではない。
**kit は何も所有せず、何も実装せず、順番と時間と後始末だけを引き受ける。**

## 2. スコープ内

| 領域 | 具体 | 状態 |
| --- | --- | --- |
| 起動オプションの正規化 | `LaunchOptions` → `ResolvedLaunchOptions`。既定値の唯一の置き場 | 実装済 `domain/launch-options.ts` |
| 既定のミニ平地ワールド | 平地・固定シード・3x3 チャンク・`surfaceY = 49` | 実装済 `DEFAULT_FLAT_WORLD` |
| 既定のスポーンキット | `surfaceY + 1` に足元、ホットバーに 3 種 | 実装済 `DEFAULT_SPAWN_KIT` |
| **起動バジェット** | 7 phase・合計 1000ms・phase 別計測と判定 | 実装済 `domain/boot-phase.ts` |
| 起動シーケンス | world → simulation → renderer → input → modules → first-frame | 実装済 `application/playground.ts` |
| **決定論的な後始末** | boot の逆順で detach、取り残し fiber ゼロ、再入可能な `launch` | 実装済 `application/playground.ts` |
| フレームポンプ | dropping queue + `forkDaemon` + 明示 `stop()` | 実装済 `application/playground.ts` |
| 呼び出し側 stage の実行 | 宣言順で毎フレーム回す | 実装済 |
| stage 順序の**検査** | 宣言順が `after` 制約と矛盾していないかの警告 | 実装済 `stageOrderViolations` |
| 姿勢の**運搬** | sim の `CameraPoseSnapshot` を render へ渡す | 実装済（`SimulationPort` → `RendererPort`） |
| ブラウザプレビューの共通ライフサイクル | canvas 所有権・RAF・再起動・停止・後始末 | 実装済 `application/browser-preview.ts` |
| 実DOM/WebGLを含むゲームE2E | 起動→操作→スクリーンショット | **mc-compose が所有**（kit はPlaywrightとゲーム実装を持たない） |

## 3. 非スコープ（明示的に持たない）

**この節が本文書の主目的である。** kit は「便利なものを置く場所」に見えるので、
放っておくと何でも入る。しかも入ったものは**出荷ビルドに存在しない**ので、
入った瞬間に「プレビューでは動くがゲームでは動かない」が生まれる。

| 持たないもの | 正しい置き場 | 根拠 |
| --- | --- | --- |
| **実行時入力サービス（キーボード/マウス/ポインタロック/タッチ/リマッピング）** | **mc-render** | plan.md §2.3-2 / §7。§3.1 で詳述 |
| **ゲームルール全般**（採掘・設置・Mob AI・ドロップ・流体・天候…） | mx-gameplay | plan.md §2.3-1、§3.11 |
| **レッドストーン電力伝播** | mx-redstone | plan.md §3.12 |
| **stage の全順序表** | **mc-compose** | plan.md §2.3-3。§3.2 で詳述 |
| **Layer の最終合成** | mc-compose | plan.md §3.15。§3.3 で詳述 |
| **セッションライフサイクル（タイトル⇄ゲーム）** | mc-compose | plan.md §3.15 |
| **`CameraPoseSnapshot` の生成・書き換え** | mc-sim（正） / mc-render（ミラー） | plan.md §5.1-2。§3.4 で詳述 |
| **deltaTime のクランプ・フレームペーシング** | mc-sim | plan.md §3.8。§3.5 で詳述 |
| **地形生成・バイオーム分類・カーバー・構造物** | mc-worldgen | plan.md §3.7 |
| **物理積分・AABB 衝突解決・voxel-DDA** | mc-physics（kit からは**推移依存で import 禁止**） | plan.md §3.4 / §2.3-5 |
| **メッシュ生成** | mc-meshing（同上） | plan.md §3.3 |
| **ノイズ関数** | mc-noise（同上） | plan.md §3.2 |
| **セーブフォーマット・永続化** | mc-save（同上） | plan.md §3.5 |
| **サウンド再生・字幕発行** | mc-audio（kit からは到達すらしない） | plan.md §3.6 |
| **DOM UI 全般** | mx-ui | plan.md §3.13。mx-ui は kit を必要としない（DOM のみで起動する） |
| **QA/デバッグAPI・Modding 入口・全体 E2E** | mc-compose | plan.md §3.15 |

### 3.1 実行時入力サービス — 最重要の非スコープ

「ミニ平地ワールド + カメラ + レンダラ + **入力**を1秒で起動する糊」と plan.md §3.10 は書く。
入力は起動対象に**含まれる**。しかし入力の**実装**は含まれない。

plan.md §2.3-2 が理由を 1 行で書いている:

> kit は devDependency 専用のため、kit に入力を置くと本番ゲームから入力が消える。

kit は出荷ビルドに入らない。入力サービスがここにあれば、リリースされたゲームは
起動し、描画し、**何にも反応しない**。バグではなく、機能が丸ごと存在しない。

したがって本リポジトリにあるのは `application/preview-ports.ts` の

```typescript
export type PreviewInputService = {
  readonly attach: Effect.Effect<void>
  readonly detach: Effect.Effect<void>
}

export class InputPort extends Context.Tag('@nerima-games/mc-playground-kit/InputPort')<
  InputPort, PreviewInputService
>() {}
```

だけである。**Tag があって実装が無い。** この不在が設計であり、
型システムが構造的に守っている: `InputPort` を満たすには、この規則が禁じている実装を
このリポジトリに書くしかない。書けば `check:deps` 以前に自明に規則違反だと分かる。

`attach` / `detach` の 2 メソッドしかないことも意図的である。ハーネスと入力の関係は
「プレビューの間だけ有効にする」に尽きる。キーマッピングもポインタロックも
タッチもゲームパッドも mc-render のものであり、ハーネスはそれらの語彙を知らない。

ヘッドレスで入力を**模擬**したいときも同じで、参照実装の仮想入力パス
（`packages/presentation/input/input-service.ts:305-318` の `setVirtualKey` /
`pulseVirtualKey` / `addVirtualLookDelta` / `setVirtualLookActive`）は mc-render の surface である。
これがなぜ死活的かは [porting.md](./porting.md) §3。

### 3.2 stage の全順序

[architecture.md](./architecture.md) §4.3 に全文。要約すると:

- kit は呼び出し側が並べた**宣言順**で stage を回す
- `after` は**検査**にだけ使い、順序の**導出**には使わない
- 矛盾があれば警告して起動する（拒否しない）

「検査は安全だが解決は危険」。解決器が 2 つあると、プレビューと出荷ゲームが食い違いうる。

### 3.3 Layer の合成

plan.md §4.1 の `GameModule<ROut, E, RIn>` は `layers` と `frameStages` の 2 つを持つ。
**kit は後者しか受け取らない**（`domain/launch-options.ts` の `PreviewModule`）。

理由は 2 つあり、どちらか片方だけでも十分である。

1. **アーキテクチャ上の理由。** Layer マージは mc-compose の仕事（plan.md §2.3-3）。
   ハーネスがマージすると、compose の唯一の仕事が二重実装になる。
2. **型システム上の理由。** `ReadonlyArray<GameModule<ROut, E, RIn>>` は異種リストを表現できない。
   異なるサービスを提供する 2 つのモジュールは `ROut` が違い、TypeScript にはそれを
   量化して隠す存在型がない。compose はモジュール一覧を静的に知っているので解けるが、
   実行時にモジュールを受け取るハーネスには解けない。

プレビューのサービスは、呼び出し側が `launchPlayground` に Layer を provide する
通常の Effect のやり方で入る。

### 3.4 カメラ姿勢

plan.md §5.1-2「カメラ姿勢は sim 所有」。mc-sim が正を持ち、mc-render がミラーする。

**kit はその間に立つ。だから最も危険な位置にいる。**

`renderFrame(dt, pose)` のように姿勢を引数で渡す設計にしてあるのは、
ミラーの向きが**シグネチャに現れる**ようにするためである。レンダラが姿勢を返す引数位置は無い。
`SimulationPort.cameraPose` は `Effect<CameraPoseSnapshot>` の読み取りのみで、setter は無い。

参照実装がこの逆転構造で払った代償は mc-sim の `docs/design-notes.md` DN-01 に全 13 箇所が
記録されている。ハーネスに `setCameraPose` を 1 つ足すだけで、その構造が戻る。

### 3.5 deltaTime のクランプ

`PlaygroundHandle.submitFrame` は **タイムスタンプではなく delta を受け取る**。

`min(max(0.001, raw), 0.05)` のクランプは mc-sim が所有する（plan.md §3.8、
`mc-sim/domain/frame-timing.ts`）。ここに 2 つ目の実装を置くと同期対象が増え、
食い違ったときの症状は「プレビューをバックグラウンドにして戻したらプレイヤーが床を抜けた」
になり、**物理のバグに見える**。

プレビューのフレーム駆動側（ブラウザなら `requestAnimationFrame`、テストならループ）が
mc-sim の関数で 1 回クランプし、その結果を渡す。

### 3.6 判断手順

新しいコードを kit に置くか迷ったら、順に問う。

1. **これを消したら、出荷ゲームの挙動が変わるか** → 変わるなら kit ではない
   （kit は出荷されないので、変わりようがない。変わるなら置き場所を間違えている）
2. **これは「順番」「時間」「後始末」のどれかか** → どれでもないなら kit ではない
3. **親リポジトリの誰かが、これを所有すべきではないか** → 所有者がいるなら Port にする
4. **これは 2 つ以上のリポジトリのプレビューが必要とするか** → 1 つだけなら、そのリポジトリの
   `apps/preview-*/` に置けないか再検討する

## 4. 親と子

### 親（kit が依存する）— 4 リポジトリ

| リポジトリ | 使うもの | 現状 |
| --- | --- | --- |
| `mc-kernel` | 語彙全般（`DeltaTimeSecs`、`StageId`、`Position`、`CameraPoseSnapshot`、Clock Port、`GameModule`） | 公開 package から直接 import |
| `mc-worldgen` | ミニ平地ワールドの生成・破棄 | `WorldProviderPort` |
| `mc-sim` | スポーン / tick / 姿勢の読み取り / 停止 | `SimulationPort` |
| `mc-render` | 描画（`RendererPort`）**と実行時入力**（`InputPort`） | 2 つの Port |

`mc-render` だけが 2 つの Port に分かれているのは、責務がはっきり別だからであり、
かつ入力の所有権（§3.1）を surface の形で可視化するためである。

### 子（kit に依存する）— **実行時はゼロ**

| リポジトリ | 依存の種類（意図された最終形） | 何を使うか | kit 側で壊してはいけないもの |
| --- | --- | --- | --- |
| `mx-gameplay` | **devDependency のみ** | プレビュー 3 本の起動 | `launchPlayground()` が無引数で完結すること |
| `mx-redstone` | **devDependency のみ** | 回路盤プレビューの起動 | 同上 + `modules` による stage 注入 |
| `mc-worldgen` / `mc-sim` / `mc-render` の `apps/preview-*/` | **devDependency のみ** | 各内蔵プレビューの起動 | `launch` の再入可能性 |

> **現状**: この表は**意図された最終形**である。
> **今日この kit を依存に持つリポジトリは 1 つも無い**（どの `package.json` にも
> `@nerima-games/*` の宣言は無く、`apps/preview-*/` もまだどこにも存在しない）。
> publish が始まっていないためで、plan.md §6 Step 3 の bottom-up publish-then-pin に沿う。
> 「kit 側で壊してはいけないもの」の列は、その日が来る前に守るべき制約として今日から効く。

**この表に「実行時依存」の行が 1 つもないこと自体が、本リポジトリの最重要の不変条件である。**
`test/check-dependency-whitelist.test.ts` の
`this repository sits at the TOP of the runtime graph: nothing depends on it` が
依存グラフ 16 行を走査してこれを assert している。
