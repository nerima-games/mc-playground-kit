# @nerima-games/mc-playground-kit

## 責務

プレビュー用共通ハーネス。「ミニ平地ワールド + カメラ + レンダラ + 入力」を **1 秒で起動する糊**。

plan.md §3.10 はこのリポジトリを **最も丁寧に作る部品** と名指ししている:

> **全プレビューの開発体験がここの起動速度と安定性に依存する**

他の 15 リポジトリの完了条件（plan.md §6 Step 2）はすべて「内蔵プレビューが操作可能」を含み、
そのプレビューは全部ここを通って起動する。ここが遅ければ全員が遅く、
ここが不安定なら全員が不安定になる。

詳細は [`docs/responsibility.md`](./docs/responsibility.md)（**非スコープの明示を含む**）。

## このパッケージは devDependency である。常に。

plan.md §2.3-2:

> kit は devDependency 専用のため、kit に入力を置くと本番ゲームから入力が消える。
> kit の役割は「ミニ世界 + カメラ + レンダラ + 入力を1秒で束ねる糊」に限定

これは帳簿上のルールではない。**実行時入力サービスが mc-render にあるのは、
このハーネスが出荷されないからである。** 入力をここに置けば、リリースビルドは
ビルドが通り、起動し、描画し、キーボードを完全に無視する。

故障の経路を具体的に書く。4 と 5 の間に人間のレビューしか無い状態にはしない、
というのがこの規則である。

1. mx-gameplay の開発者が、プレビューで動く入力処理を便利だと思う
2. 出荷コードから `import { InputService } from '@nerima-games/mc-playground-kit'` する
3. **ローカルでは動く**（dev-meta workspace には kit がある）
4. **`pnpm build` は通る**（TypeScript 的には何も間違っていない）
5. **出荷ビルドに kit が含まれないので、リリースされたゲームはキーボードに反応しない**

`InputPort` はこのリポジトリで **Tag だけがあり実装が無い**。その不在が設計である。
型システムが構造的に守っている: これを満たすには、規則が禁じている実装をここに書くしかない。

強制は機械的に行われる（`scripts/check-dependency-whitelist.ts`）。
16 リポジトリ全部が同じスクリプトを持つので、どこで違反してもそのリポジトリの CI が落ちる。

| 違反 | 検出ルール |
| --- | --- |
| どこかの `dependencies` に kit がある | `dev-only-package-in-dependencies` |
| 出荷ソース（`index.ts` / `domain/` / `application/`）から kit を import | `dev-only-package-in-shipped-source` |

**逆向きの誤解に注意**: 制約は「誰が kit に依存してよいか」についてのものである。
kit 自身が mc-worldgen / mc-sim / mc-render に依存するのは正常な実行時依存であり、
プレイグラウンドは実際に世界とシミュレーションとレンダラを実行時に構築する。

**既知の限界**: 本リポジトリ自身のコピーでは `dev-only-package-in-shipped-source` は発火しない
（自己 import 判定が先に走り `self-import` が勝つ）。import 側の規則は他の 15 リポジトリの
コピーでのみ検証される。実測と対処は [`docs/design-notes.md`](./docs/design-notes.md) DN-01。

## 依存

| 依存先 | 何をもらうか | Port |
| --- | --- | --- |
| `mc-kernel` | 共有語彙。どのリポジトリからも import 可（許可リストに書かずに import できる） | — |
| `mc-worldgen` | ミニ平地ワールドの生成・破棄 | `WorldProviderPort` |
| `mc-sim` | スポーン / tick / `CameraPoseSnapshot` の読み取り / 停止 | `SimulationPort` |
| `mc-render` | 描画一式 | `RendererPort` |
| `mc-render` | **実行時入力サービス** | `InputPort`（**実装無し**） |

`mc-meshing` / `mc-physics` / `mc-save` / `mc-noise` は **import できない**（推移依存）。
`mc-audio` と `mx-*` / `mc-compose` には到達すらしない。

**現在の `dependencies` は `effect` のみ。** 上記 4 つはまだどれも publish されていないため
（plan.md §6 Step 3 の bottom-up publish-then-pin）、
サービス群は `application/preview-ports.ts` の Port 越しに受け取る形になっている。
kernel の語彙は `domain/kernel-vocabulary.ts` に暫定ミラーしてあり、kernel 公開時に削除する。

publish 後も Port のままにする理由は [`docs/design-notes.md`](./docs/design-notes.md) DN-07:
E2E 環境が SwiftShader かつポインタロック不可である以上、起動順序・後始末順序・再入可能性は
**Node で検証しなければならない**。

## このリポジトリの位置づけ

4 層アーキテクチャの**基盤**層。ただし他の基盤 3 つ（worldgen / sim / render）とは性質が違い、
**出荷物ではなく開発ツール**である。

```
mx-gameplay ┐
mx-redstone ┘ …… devDependency としてのみ参照（点線）
                        ┊
              mc-playground-kit
                        ↓
         mc-worldgen / mc-sim / mc-render  (+ mc-kernel)
```

**kit に入ってくる実行時エッジは 1 本もない。**
`test/check-dependency-whitelist.test.ts` の
`this repository sits at the TOP of the runtime graph: nothing depends on it` が
依存グラフ 16 行を走査してこれを assert している。入ってくるエッジが無いパッケージは、
事故で実行時依存になれない。なるには `package.json` を明示的に編集するしかなく、
それはゲートが捕まえる。

構築順（plan.md §6 Step 2）は `worldgen → sim → render → kit → gameplay / redstone → ui →
multiplayer → compose`。**kit は基盤の最後**であり、ここから先の体験モジュールは
すべてこのハーネスの上でプレビューされる。

依存グラフ全体・4 階層・名詞/動詞ルール・**devDependency 専用規則の全詳細**・
stage 全順序の所有者は [`docs/architecture.md`](./docs/architecture.md) を参照。

### 依存ルール（16 リポジトリ共通）

| ルール | 内容 |
| --- | --- |
| ハード失敗 | 違反があれば CI は必ず非ゼロ終了する。警告で済ませない |
| 循環禁止 | 循環依存は一切許可しない。「co-evolution ペア」のような例外リストは設けない |
| 推移閉包の禁止 | A→B、B→C のとき A は C を import できない |
| kernel は例外 | mc-kernel はどこからでも import 可（`dependencies` への記載は必要） |
| 宣言と実体の一致 | import する `@nerima-games/*` は `package.json` に記載必須 |
| mc-playground-kit は devDependency 専用 | **本リポジトリのこと。** 上記参照 |
| `Date.now()` 禁止 | 時刻はすべて注入された Clock Port から取得する |

`scripts/check-dependency-whitelist.ts` は 16 リポジトリ共通のテンプレートである。
冒頭で囲ってある `REPOSITORY_POLICY` 定数だけを書き換え、それ以外はそのままコピーする。
本リポジトリの版は **plan.md §2.1 の 16 リポジトリ全行**を保持しており、循環検査が全体を見る。

### `Date.now()` 禁止の実装方法

oxlint 0.12 は `no-restricted-syntax` も `no-restricted-properties` も実装しておらず、
`no-restricted-globals` は `oxlint --rules` の一覧に出るものの実装されていない
（mc-kernel で 0.12.0 に対し実測確認済み。3 ルールすべて設定した状態で `Date.now()` を書いても診断 0 件）。

そのため禁止は **`scripts/check-dependency-whitelist.ts` 側で実装**している。
対象は `Date.now()` / `new Date()` / `performance.now()` の 3 つ。
コメント・文字列リテラル・正規表現リテラルの中身はマスクされるので誤検知しない。

**このリポジトリでは `performance.now()` が特に危険である。** 起動時間の計測が責務の中心にあり、
素朴に書けば必ず `performance.now()` に手が伸びる。起動時間の計測も注入された Clock Port から行う。
その結果として**起動バジェットのテストが Node で決定論的に走り、CI マシンの負荷で落ちない**
（[`docs/design-notes.md`](./docs/design-notes.md) DN-09）。

Clock Port の実装アダプタだけは `mc-kernel-allow-time-source` コメントで除外できるが、
**そのアダプタは本リポジトリには無い**（kit は `ClockPort` を要求する側）。

## 使い方

```typescript
import { Effect } from 'effect'
import { launchPlayground, PlaygroundLayer } from '@nerima-games/mc-playground-kit'

const program = Effect.gen(function* () {
  // 引数ゼロで完結する。これが本リポジトリの中心的な契約。
  const playground = yield* launchPlayground()

  console.log(playground.budget)          // 起動バジェットの判定（ログにも出る）
  yield* playground.submitFrame(dt)       // dt は mc-sim の clampFrameDelta を通した値
  yield* playground.stop                  // boot の逆順で teardown
})

// PlaygroundLayer に加えて ClockPort / WorldProviderPort / SimulationPort /
// RendererPort / InputPort を provide する。実装は各親リポジトリが提供する。
```

`launchPlayground()` が**引数ゼロで立って歩けるワールドを出す**ことが契約である。
これが崩れると 15 リポジトリのプレビューがそれぞれ定型文を持ち、その定型文が drift する。

2 回目の `launchPlayground()` は 1 回目を**自動的に破棄する**（ホットリロードの実態）。
これが自由関数ではなくサービス経由である理由:
自由関数は、自分が知らない過去の起動を後始末できない。

API 全体は [`docs/public-api.md`](./docs/public-api.md)。

## 開発

### セットアップ

```console
$ direnv allow          # flake.nix の devShell で nodejs_24 + corepack が入る
$ pnpm install
```

Nix を使わない場合は Node.js 24 以上と pnpm 11（`corepack` 推奨）を用意する。

> **注意**: ツールチェーンは `devenv.nix` から `flake.nix` + `flake.lock` に移行済みである。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。`devenv.nix` / `devenv.lock` はもう存在しない。

### コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json` / `tsconfig.test.json` / `tsconfig.preview.json` の 3 プロジェクトを型検査 |
| `pnpm lint` | oxlint（このリポジトリ唯一の lint / format 設定。prettier も biome も .editorconfig も置かない）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`oxlint.json` は 5 カテゴリすべてと個別 67 ルールが `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| `pnpm lint:fix` | oxlint の自動修正 |
| `pnpm preview` | 内蔵プレビュー（ハーネスが自分自身をプレビューする）。**`pnpm verify` には入らない**。[`apps/preview-harness/README.md`](./apps/preview-harness/README.md) |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect` が主 API、`environment: 'node'`） |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | カバレッジ計測（閾値は未設定。後述） |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + `Date.now()` 禁止の検査 |
| `pnpm api:check` | `api-lock.md` が実際の公開 API と食い違えば非ゼロ終了（[`docs/public-api.md`](./docs/public-api.md) §7） |
| `pnpm api:update` | `api-lock.md` を書き直す。公開面を変える PR は結果を同じ PR に含める |
| `pnpm verify` | `typecheck && lint && check:deps && api:check && test`。CI と同じ内容 |

## 現状

**このリポジトリはまだ叩き台（pre-audit first cut）である。**

入っているのは、plan.md §3.10 の「1 秒で起動」と「devDependency 専用」という 2 つの要求を
**型と回帰テストとして最初から焼き込む**ための最小実装だけ。

| 領域 | 実装 | 設計注意 |
| --- | --- | --- |
| devDependency 専用の強制 | `scripts/check-dependency-whitelist.ts` | DN-01 |
| 起動オプション（引数ゼロで完全な設定になる正規化。純粋・全域） | `domain/launch-options.ts` | DN-02 |
| 起動予算（7 フェーズ / 合計 1000 ms / 判定関数） | `domain/boot-phase.ts` | DN-02 |
| 再入可能な `launch` / 取り残し fiber ゼロ | `application/playground.ts` | DN-03 |
| teardown は boot の逆順（**input が最初**） | `application/playground.ts` | DN-04 |
| stage 順序の**検査**（解決ではない） | `domain/launch-options.ts` | DN-05 |
| deltaTime クランプを**持たない**（mc-sim 所有） | `application/playground.ts` | DN-06 |
| サービス境界を Port で注入 | `application/preview-ports.ts` | DN-07 |
| カメラ姿勢は運ぶだけ（書き戻す口が無い） | `application/preview-ports.ts` | DN-08 |

起動フェーズの内訳（`BOOT_PHASE_BUDGET_MILLIS`）。所有リポジトリが phase ごとに違うので、
内訳は「どのリポジトリを見に行くか」を教える:

| フェーズ | 予算 (ms) | 所有 |
| --- | ---: | --- |
| `resolve-options` | 5 | kit（純粋関数） |
| `world` | 400 | mc-worldgen |
| `simulation` | 120 | mc-sim |
| `renderer` | 300 | mc-render |
| `input` | 25 | mc-render |
| `modules` | 50 | 呼び出し側 |
| `first-frame` | 100 | 全員 |
| **合計** | **1000** | |

参考: 参照実装の出荷セッションは最低 2500 ms のローディング画面
（`session-loading-gates-state.ts:1`）に、120fps × 10 サンプルの FPS ゲート（同 :2-5、
タイムアウト 8 秒）を積む。**ゲームには正しく、プレビューには致命的**である。
これがこのリポジトリが別に存在する理由そのもの（[`docs/design-notes.md`](./docs/design-notes.md) DN-02）。

各 DN の参照実装証跡（file:line）と、書くべき回帰テストの一覧は
[`docs/design-notes.md`](./docs/design-notes.md)。テストは現在 **5 ファイル / 100 件**。

### まだ無いもの

- **実サービスの Layer。** 4 つの Port はいずれも Tag だけで、mc-worldgen / mc-sim / mc-render の
  実装を差す Layer が無い。それらが publish されるまで作れない。
  **したがって「実際に 1 秒で起動する」ことは 1 ミリも検証されていない**
  — 現状のバジェットテストが見ているのは配分の算術だけである。
- **自身の最小 E2E**（起動 → 操作 → スクリーンショット。plan.md §3.10 検証）。**完了条件の半分。**
  Playwright は未導入。E2E は SwiftShader で動き、**ヘッドレスではポインタロックが使えない**
  （`e2e/gameplay/player-controls.e2e.ts:208`）。操作は mc-render の仮想入力
  （`setVirtualKey` / `addVirtualLookDelta`）で与える。
  **E2E に FPS アサーションと起動バジェット検証は置かない** — SwiftShader 下の数値は
  実機の数値ではないため（[`docs/testing.md`](./docs/testing.md) §2.2）。
- **`apps/preview-template/`。** consumer が自分のプレビューを作る出発点。
- **`ItemId` が暫定 `string`。** 本来は mc-kernel の `ItemType`（リテラル union、網羅性チェックつき）。
- **ビルド／publish はまだない。** `exports` は TypeScript ソースを直接指している。
  `version` は `0.x` に留める（[`docs/versioning.md`](./docs/versioning.md)）。
- **カバレッジ閾値は未設定。** 参照実装は 99% を強制しているが、スケルトンに閾値を課しても意味がない。
  計測とレポートは常に動かしており、99% ゲートは完了条件到達時に有効化する。
  なお kit のカバレッジは **Port の向こう側を測れない**ので、99% でも起動時間は保証しない。
- **`domain/kernel-vocabulary.ts` は暫定ミラー。** mc-kernel 公開時に削除する。
  `index.ts` から re-export していないのは、真実の出所を 2 つにしないため。
- **`FIRST_FRAME_DELTA_SECS` は暫定複製**（0.016）。mc-sim 公開時に import に置き換えて削除する。

## ドキュメント

[`docs/README.md`](./docs/README.md) が索引。

| ドキュメント | 内容 |
| --- | --- |
| [docs/architecture.md](./docs/architecture.md) | 4 階層、全 16 リポジトリの依存グラフ、**devDependency 専用規則の全詳細**、stage 全順序の所有者 |
| [docs/responsibility.md](./docs/responsibility.md) | 責務と、**明示的な非スコープ**（実行時入力・ゲームルール・stage 全順序・Layer 合成・deltaTime クランプを持たない理由） |
| [docs/public-api.md](./docs/public-api.md) | `launchPlayground` の実際の型。参照実装との照合（**対応物が無い箇所は無いと明記**） |
| [docs/design-notes.md](./docs/design-notes.md) | DN-01〜DN-09。参照実装の file:line 証跡つき。**各項目は書くべき回帰テスト名として表現** |
| [docs/porting.md](./docs/porting.md) | **移植元は無い（新規）。** 引き継ぐのは E2E 環境の知見。近縁コードの**実測 LOC** |
| [docs/testing.md](./docs/testing.md) | 検証要件、完了条件、E2E に**書かないこと**、カバレッジゲートの投入時期 |
| [docs/versioning.md](./docs/versioning.md) | 0.x → 1.0.0 方針、**devDependency 専用がバージョニングに与える効果** |

## License

MIT
