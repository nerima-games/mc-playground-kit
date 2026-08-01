# バージョニングと公開

## 1. 現状

| 項目 | 値 |
| --- | --- |
| `version` | `0.1.0` |
| 公開状態 | **未公開**。GitHub Packages にも上げていない |
| `main` / `types` / `exports` | **TypeScript ソースを直接指す**（`./index.ts`）。ビルド成果物ではない |
| ビルドパイプライン | **無い**。全 tsconfig が `noEmit: true` の検査専用 |
| `dependencies` | `effect` のみ |
| 消費のされ方 | **devDependency としてのみ**（plan.md §2.3-2） |

最後の 1 行が、本リポジトリのバージョニングを他の 14 リポジトリと別物にしている。

## 2. なぜ `0.x` に留めるのか

plan.md §6 Step 3 / §8:

> 界面が安定した（APIロック4週間無変更）リポジトリから GitHub Packages 等へ npm 公開 +
> changesets 運用に切り替え。それまでは dev-meta workspace 統合で開発。

> **新規構築初期は全界面が高churn** → npm公開を遅らせ dev-meta workspace で開発（§6 Step 0）。
> bump連鎖を構造的に回避

kit は 4 つの未公開リポジトリの上に立つ（[architecture.md](./architecture.md) §3.1）ので、
**そもそも今 publish しても誰も pin できる状態にない**。
plan.md §6 Step 2 の構築順が `worldgen → sim → render → kit` である以上、
kit は 4 番目以降にしか安定しえない。

## 3. devDependency 専用であることのバージョニング上の帰結

**ここが本リポジトリ固有の節である。**

### 3.1 バージョンの揺れが出荷ビルドを壊せない

kit は出荷ビルドに含まれない（plan.md §2.3-2）。したがって:

| | 出荷される 14 リポジトリ | mc-playground-kit |
| --- | --- | --- |
| 破壊的変更が壊すもの | 下流の出荷ビルド。bump 連鎖が compose まで波及する | **開発者の手元のプレビューだけ** |
| リリース済み製品への影響 | ある | **無い**。リリース済みバイナリに kit は入っていない |
| bump の緊急度 | 高い（セキュリティ・不具合修正が下流に届く必要がある） | 低い |

**だから kit は速く動いてよい。** 界面を変えたければ変えればよく、
壊れるのは「プレビューが起動しない」であって「出荷ゲームが動かない」ではない。
プレビューが起動しなければ、開発者はその場で気づいて直す。

### 3.2 それでも `dependencies` に現れてはならない

§3.1 は「気楽でよい」という話であって、「規則が緩い」という話ではない。**逆である。**

速く動いてよいのは、出荷ビルドに入らないからである。**入った瞬間にその前提が消える。**
そして入ってしまったことは、リリースされたゲームがキーボードに反応しない、という形で
最終ユーザに露見する（[design-notes.md](./design-notes.md) DN-01）。

したがって:

- kit は**どのリポジトリの `dependencies` にも現れてはならない**。
  `scripts/check-dependency-whitelist.ts` の `dev-only-package-in-dependencies` が
  16 リポジトリ全部で強制する
- kit を `dependencies` に入れることは、**バージョニング上の判断ではなく規約違反**である。
  「一時的に入れておいて後で直す」は無い

### 3.3 `0.x` の間の運用

`0.x` では semver の互換保証が働かない（`^0.1.0` は `0.2.0` を受け入れない）。
dev-meta workspace で開発している間は問題にならないが、publish 後 `1.0.0` 前の期間は:

- **破壊的変更 = minor bump**（`0.1.0` → `0.2.0`）
- **後方互換の追加・修正 = patch bump**（`0.1.0` → `0.1.1`）
- 下流は `~0.1.0` ではなく **`0.1.x` を明示ピン**して、意図しない minor 取り込みを防ぐ

kit の場合、下流はすべて `devDependencies` の行なので、ピンの更新も
「プレビューが動かなくなったら上げる」で回る。

## 4. `0.x` → `1.0.0` の条件

`1.0.0` は「完成した」の意味ではなく「**この界面を壊さないと約束する**」の意味である。
kit が `1.0.0` を出せるのは、以下がすべて満たされたとき。

1. **[testing.md](./testing.md) §2 の完了条件を満たしている。**
   テスト green **かつ**最小 E2E（起動→操作→スクリーンショット）が動く。
2. **実 Layer で起動バジェット（1 秒）を満たしている。**
   現状のバジェットテストは fake の擬似コストで算術を見ているだけで、
   実際に 1 秒で起動することは 1 ミリも保証していない
   （[testing.md](./testing.md) §5）。plan.md §3.10 の要件は実測の 1 秒である。
3. **4 つの Port すべてに実装が存在する。**
   mc-worldgen / mc-sim / mc-render が publish され、
   `WorldProviderPort` / `SimulationPort` / `RendererPort` / `InputPort` を満たす
   Layer が実在すること。
4. **下流が実際に消費して契約を確認している。**
   少なくとも mx-gameplay のプレビュー 3 本と mx-redstone の回路盤プレビューが
   kit で起動していること。**使われていない界面に「壊さない」と約束しても意味がない。**
5. **1.0.0 への昇格は、日数計測ベースの自動ゲートではなく maintainer(take)の裁量判断による**
   （[RELEASE_STANDARD.md §4.2](https://github.com/nerima-games/.github/blob/main/RELEASE_STANDARD.md#42-新しい昇格ポリシー人間による裁量判断)）。
   従来想定されていた「`api-lock.md` が 4 週間変更されなければ凍結」という freeze-clock は
   `api-lock.md` 自体の廃止に伴い廃止された。定量的な代替基準(変更なし日数・利用実績件数など)も
   導入しない。判断材料は都度異なってよく、事前にすべて明文化することは求めない。
6. `domain/kernel-vocabulary.ts` が削除され、`@nerima-games/mc-kernel` を
   `dependencies` から参照している（§6）。
7. `application/playground.ts` の `FIRST_FRAME_DELTA_SECS` が削除され、
   mc-sim から import されている（[design-notes.md](./design-notes.md) DN-06）。

条件 4 が効く順序上、kit は **mc-worldgen / mc-sim / mc-render よりは後、
mx-gameplay / mx-redstone よりは先**に `1.0.0` になる。

### 4.1 1.0.0 で凍結される「約束」は何か

具体的に何を壊さないと約束するのかを書いておく。

| 約束 | 根拠 |
| --- | --- |
| **`launchPlayground()` は引数ゼロで完結する** | [public-api.md](./public-api.md) §2.1。これが崩れると 15 リポジトリのプレビューが定型文を持つ |
| `LaunchOptions` の全フィールドは省略可能であり続ける | 同上 |
| `launch` は再入可能であり続ける | [design-notes.md](./design-notes.md) DN-03。relaunch がハーネスの存在理由 |
| teardown は boot の逆順で、input を最初に外す | DN-04 |
| **kit は stage の全順序を解決しない** | DN-05 / plan.md §2.3-3。解決し始めたら compose と競合する |
| **kit は入力サービスを実装しない** | DN-01 / plan.md §2.3-2 |
| `submitFrame` は delta を取り、クランプしない | DN-06 |
| `CameraPoseSnapshot` を書き戻す口を作らない | DN-08 / plan.md §5.1-2 |

**下の 4 つは「界面の形」ではなく「持たないことの約束」である。**
`api-lock.md` / `scripts/api-lock.ts` / `pnpm api:check` という自動 API スナップショット/diff
ツールは org 標準として廃止した（[API_STANDARD.md §4](https://github.com/nerima-games/.github/blob/main/API_STANDARD.md)）。
`setCameraPose` や `resolveStageOrder` のような約束していない公開シンボルが追加されていないかは、
以降 maintainer のレビュー(自己レビュー含む)で守る。

### 4.2 バジェットの変更は破壊的変更か

**`BOOT_BUDGET_MILLIS` を大きくすることは破壊的変更として扱う。**

型は変わらないので API ロックには映らない。それでも破壊的なのは、
**この数字が本リポジトリの要件そのもの**だからである（plan.md §3.10「1秒で起動」）。
1000 を 3000 にする変更は、テストを緑にしながら本リポジトリの存在理由を消す。

`test/boot-phase.test.ts` が 1000 をリテラルで固定しているのはそのため。
**phase 間の再配分は自由、合計の変更は要議論。**

## 5. GitHub Packages

`package.json`:

```json
"publishConfig": {
  "registry": "https://npm.pkg.github.com",
  "access": "restricted"
}
```

- スコープは `@nerima-games`。GitHub Organization `nerima-games` 配下のリポジトリと対応する。
- `access: restricted`（private）。plan.md §9 の未決事項「パッケージ公開先」は
  GitHub Packages で確定したものとして扱う。
- 消費側は `.npmrc` に `@nerima-games:registry=https://npm.pkg.github.com` と
  `//npm.pkg.github.com/:_authToken=...` が要る。**現在の `.npmrc` にはまだ書いていない**
  （公開物が無いため）。最初の publish と同時に 16 リポジトリ分を揃える。

### 5.1 `files` に何を入れるか

現在の `package.json#files`:

```json
["index.ts", "domain", "application", "tsconfig.base.json", "LICENSE", "README.md"]
```

`scripts/` と `test/` は入っていない。妥当である。
ただし kit は devDependency 専用なので、**consumer は必ず開発環境である**。
将来 `apps/preview-template/` のような雛形を持つなら、それは `files` に入れる価値がある
（consumer が「自分のプレビューを作る」ときの出発点になる）。現状は未実装。

## 6. `domain/kernel-vocabulary.ts` の削除

**publish 運用より前に片付ける負債。**

nothing-is-published のブートストラップ問題を回避するため、mc-kernel の語彙のうち
kit が使う分だけを `domain/kernel-vocabulary.ts` にミラーしてある。
mc-kernel が publish されたら:

1. `@nerima-games/mc-kernel` を `package.json#dependencies` に追加
2. `domain/kernel-vocabulary.ts` を削除
3. `from './kernel-vocabulary'` を `from '@nerima-games/mc-kernel'` に置換

**これで型検査が通らなければ、ミラーが drift しており、その drift 自体がバグである。**

### 6-1. `ClockService` は**丸ごと**ミラーする。ミラーが最小であってはならない唯一の箇所

`ClockService` は 2 フィールドである（`monotonicSecs` + `wallClockEpochMillis`）。
kernel の実物（`mc-kernel/domain/clock.ts:43-48`）が 2 フィールドだからで、
**本リポジトリは `wallClockEpochMillis` を 1 度も読まないが、それでもミラーしてある。**

理由は型検査だけではない。`ClockPort` は `Context.Tag` であり、
Effect は Tag を**その文字列キー**（`'@nerima-games/mc-kernel/ClockPort'`）で解決する。
全リポジトリのミラーが同じキーを使っているので、**それらは実行時には同じ 1 つのサービス**でありながら、
TypeScript にとっては無関係な名前的別型である。したがって狭いミラーは「語彙が少ない」ではなく、

- 1 フィールドのミラーに対して組んだ `Layer` が 2 フィールドの Tag を**満たしてしまい**、
- 足りないフィールドは、そのミラーを見たことのないリポジトリで `undefined` として読まれる。

**これは実際に起きていた。** mc-sim のミラーが 1 フィールドで、
kernel と本リポジトリが 2 フィールドだった。本リポジトリは mc-sim に依存するので、
両者は同じバンドルに同居する。`tsc` は最後まで何も言わない。

現在は 3 つのミラーすべてが kernel と同形であり、
`test/kernel-mirror.test.ts`（mc-sim / mc-render / 本リポジトリの 3 か所にある）が
Tag キーの文字列とサービスの形を**両方向で**固定している——狭めても広げても CI が落ちる。
`FixedClockLayer` がオブジェクト引数を取ることも同様に固定してある。

なお `index.ts` はこのミラーを **re-export していない**。consumer が kit 経由で
kernel の語彙を取ると真実の出所が 2 つになり、上記の削除が破壊的変更に化けるためである。

## 7. ビルド / publish パイプライン（完了時に追加）

現在 `noEmit: true` で `exports` が `.ts` を指しているのは、**consumer が TypeScript を
直接コンパイルする前提**の暫定形。dev-meta workspace 内では動くが、publish 物としては不可。

完了条件到達時に追加するもの:

| 項目 | 内容 |
| --- | --- |
| ビルド | `tsconfig.build.json` の `noEmit` を外し `outDir: dist` + `declaration` |
| `exports` | `{ ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }` |
| `files` | `dist` 中心に変更 |
| changesets | plan.md §6 Step 3。bump とチェンジログの運用 |
| publish ワークフロー | `.github/workflows/` に追加。タグ or changeset 起点 |
| **E2E ワークフロー** | `.github/workflows/` に追加。SwiftShader / `workers: 1`（[testing.md](./testing.md) §2.2） |
| カバレッジ 99% ゲート | `vitest.config.ts` + CI（[testing.md](./testing.md) §5） |

`.gitignore` は既に `dist/` `build/` `out/` を無視するようにしてある。

**APIロックの diff チェックはこの表にはもう無い。** `api-lock.md` / `scripts/api-lock.ts` /
`pnpm api:check` は org 標準の移行に伴い廃止した。`pnpm verify` は
`typecheck && lint && test` の3段構成に確定している（[TEST_STANDARD.md §1](https://github.com/nerima-games/.github/blob/main/TEST_STANDARD.md)）。

## 8. 依存の固定

| 依存 | 現在 | 方針 |
| --- | --- | --- |
| `effect` | `^3.20.0` | 16 リポジトリで**同一メジャーに揃える**。Context / Layer の型が跨るため、メジャーが混ざると合成できない |
| `@nerima-games/*` | 未宣言 | publish 後は**厳密ピン**（`0.3.1` のように範囲なし）。plan.md の bottom-up publish-then-pin |
| `@playwright/test` | **未導入** | 最小 E2E 導入時に devDependency として追加（[testing.md](./testing.md) §2.1） |
| `typescript` / `vitest` / `oxlint` | `^` 付き | ツールチェーンは揃えるが厳密ピンはしない |
| `packageManager` | `pnpm@9.15.0` | 16 リポジトリで同一 |

`engines.node` は `>=22.0.0`。`flake.nix` の devShell が `nodejs_22` を入れる。
