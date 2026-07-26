# mc-playground-kit ドキュメント索引

`@nerima-games/mc-playground-kit` の実装情報一式。上位仕様は plan.md（**非公開**）、
参照実装は `<reference-impl>`（凍結・テストオラクル扱い）。
本ディレクトリ内の参照実装パスはすべて ts-minecraft リポジトリルート相対で書く。

## 表記

| 表記 | 意味 |
| --- | --- |
| `<reference-impl>` | **参照実装のチェックアウトのルート**。凍結された `takeokunn/ts-minecraft` の作業コピーを指す。本ドキュメント群では `<reference-impl>/packages/…` の形か、単に `packages/…`（同じくルート相対）で引用する。手元のどこに clone してあっても読み替えられるようにするためのプレースホルダである |
| plan.md | リポジトリ構成仕様書（16 リポジトリ、確定済み）。**非公開**であり、公開読者は開けない。だから本ドキュメント群は「plan.md を読まなくても追える」ことを要件にしている —— plan.md の主張を引くときは必ず原文を引用し、参照実装での裏づけを file:line で添える |
| `nerima-games/<repo>` | 同 org の兄弟リポジトリ。リンクは GitHub の URL で張る |

## このリポジトリを一言でいうと

**全プレビューの起動を担う糊であり、plan.md が「最も丁寧に作る部品」と名指しした唯一のリポジトリ。**

plan.md §3.10 原文:

> 「ミニ平地ワールド + カメラ + レンダラ + 入力」を1秒で起動する糊。
> **全プレビューの開発体験がここの起動速度と安定性に依存する — 最も丁寧に作る部品**

plan.md §6 Step 2 は 15 リポジトリすべての完了条件に「内蔵プレビューが操作可能」を課している。
そのプレビューは全部ここを通って起動する**ことになる**。**ここが遅ければ全リポジトリの開発が遅くなり、
ここが不安定なら全リポジトリのプレビューが信用できなくなる。**

> **現状（2026-07-26）**: **プレビューは全 16 リポジトリを通じて 1 本も存在しない。**
> `apps/` ディレクトリ自体がどのリポジトリにも無く、
> どの `package.json` にも `@nerima-games/*` の依存宣言が無い（publish 前のため）。
> 本リポジトリ自身の最小 E2E も未着手である（下記「いま何が入っているか」）。
> つまり **plan.md §6 Step 2 の完了条件「内蔵プレビューが操作可能」を満たすリポジトリは現時点でゼロ**であり、
> それは本リポジトリがまだ誰にも使われていないことと同じ事実の裏表である。
> プロジェクト全体の進捗はこの 1 点に律速される。
> 横断の現況は mc-dev-meta の
> [step2-status.md](https://github.com/nerima-games/mc-dev-meta/blob/main/docs/step2-status.md) を見ること。

そして本リポジトリは **出荷ビルドに入らない**（plan.md §2.3-2）。
この 2 つ — 「全部が依存する」と「何も出荷しない」— の組み合わせが、本リポジトリの設計を
ほぼすべて決めている。

## 読む順序

| 文書 | 内容 | 誰が読むか |
| --- | --- | --- |
| [architecture.md](./architecture.md) | 4階層アーキテクチャ、依存グラフ全体、本リポジトリの位置、名詞/動詞ルール、**kit の devDependency 専用規則の全詳細**、stage 全順序の所有者 | 最初に全員 |
| [responsibility.md](./responsibility.md) | plan.md §3.10 の責務、**非スコープ**の明示（実行時入力サービスを持たない理由）、親と子 | 機能を足す前に |
| [public-api.md](./public-api.md) | `launchPlayground` の実際の型。参照実装の実コードと突き合わせて検証済み（対応物が無い箇所は無いと明記） | API を触る人 |
| [design-notes.md](./design-notes.md) | 設計注意の全項目。参照実装の file:line 証跡つき。**各項目は書くべき回帰テスト名として表現している** | 実装する人（必読） |
| [porting.md](./porting.md) | **移植元は無い（新規）。** 引き継ぐのは E2E 環境の知見。近縁コードの**実測 LOC**（`wc -l` 実行値） | 移植する人 |
| [testing.md](./testing.md) | 検証要件、完了条件（**自身の最小 E2E が操作可能**）、カバレッジゲートの扱い | テストを書く人 |
| [versioning.md](./versioning.md) | 0.x → 1.0.0 の方針、GitHub Packages、**devDependency 専用であることがバージョニングに与える効果** | リリースする人 |

## いま何が入っているか

**pre-audit first cut（叩き台）。** 動くコードは以下だけで、いずれも
「起動速度と安定性を、回帰テストとして最初から焼き込む」ためのもの。

| 領域 | 実装 | 対応する設計注意 |
| --- | --- | --- |
| 起動オプションの正規化 | `domain/launch-options.ts` | DN-02 |
| 起動バジェット（1秒）と phase 別計測 | `domain/boot-phase.ts` | DN-02 |
| 兄弟リポジトリの surface を Port として注入 | `application/preview-ports.ts` | DN-01 / DN-07 |
| 再入可能な launch / 決定論的 teardown | `application/playground.ts` | DN-03 / DN-04 |
| stage 順序の**検査**（解決ではない） | `domain/launch-options.ts` | DN-05 |
| devDependency 専用の強制 | `scripts/check-dependency-whitelist.ts` | DN-01 |

まだ無いもの: **自身の最小 E2E（起動→操作→スクリーンショット）**、実 Layer（4 つの親リポジトリが
未公開のため Port は全部注入待ち）、`apps/preview-*/` のサンプルプレビュー。
APIロックファイルは**ある** —— `api-lock.md` と `pnpm api:check`（[public-api.md](./public-api.md) §7）。
`domain/kernel-vocabulary.ts` は mc-kernel 公開までの暫定ミラーであり、公開後に削除する。
