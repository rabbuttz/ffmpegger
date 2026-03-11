# FFMPEGGER

FFMPEGGER は、ブラウザ内だけで動画と音声を変換・トリミングする ffmpeg.wasm ベースのツールです。アップロードは行わず、処理はローカル環境で完結します。

## Development

```bash
npm install
npm start
```

デバッグログ付きで起動する場合:

```bash
npm run debug
```

公開用の静的ファイルを再生成する場合:

```bash
npm run build
```

## Distribution Notes

- このリポジトリが FFMPEGGER の対応ソース一式です。
- `dist/` には、アプリ本体のソース、依存パッケージの実行に必要なファイル、`package.json`、`package-lock.json`、`build.js`、`server.js`、`LICENSE`、`THIRD_PARTY_NOTICES.txt` を含めています。
- 公開ビルドでは `@ffmpeg/core` を CDN ではなく同梱ファイルから読み込みます。配布物だけを受け取った利用者でも、同じ場所からライセンス文書と再現情報を確認できます。

## License

Copyright (C) 2026 Rabbuttz_VR

FFMPEGGER is free software; you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation; either version 2 of the License, or (at your option) any later
version.

FFMPEGGER is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.

Third-party component notices are collected in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
