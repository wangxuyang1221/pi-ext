# Pinned media decoder

本目录把 Codex CLI 0.154.0 使用的图片解码、音频时长解析和特殊上下文解析编译为无 host import 的 WebAssembly。Node 运行时只读取预编译文件，不安装或启动 Rust，不访问网络。

## Provenance

- Codex commit: `6b9826e3aa83b1a5947db50f4332cb9c65f1b340`。
- Rust compiler: `rustc 1.97.0 (2d8144b78 2026-07-07)`。
- Target: `wasm32-unknown-unknown`。
- `image 0.25.9`，公共格式为 JPEG、PNG、GIF、WebP。完整 CLI 的 arboard 依赖在 macOS 额外开启 TIFF，在 Windows 额外开启 BMP；调用端按平台传入允许的格式。
- `symphonia 0.6.0`，仅启用 Codex 所用的 isomp4、mkv、mp3、ogg、wav demuxer。
- `quick-xml 0.41.0` 保留 hook_prompt 的原始 XML 解析语义，包括实体、CDATA、空字段和重复属性处理；`serde_json 1.0.149` 与对应 serde 声明验证 inter-agent 消息，避免 JavaScript JSON.parse 忽略重复字段等差异。
- `Cargo.lock` 固定传递依赖。`manifest.json` 记录源码、产物和许可证的 SHA-256；校验可以发现陈旧或损坏的资产，不是数字签名。

## Rebuild

安装上述编译器和 target 后，从仓库根目录执行：

```sh
CODEX_MEDIA_RUST_TOOLCHAIN=1.97.0 pnpm run codex-compact:media:generate
pnpm run codex-compact:media:verify
pnpm run build
```

生成器还需要 Rust 工具链自带的 `share/doc/rust/COPYRIGHT-library.html` 和 `share/doc/rust/licenses`。普通 `pnpm run build` 不调用 Cargo，只验证并复制资产。编译器版本不匹配时，生成器拒绝运行。修改 Rust 源码、Cargo 文件或本说明后必须重新生成 manifest。

## Redistribution

适配源码遵循 `../../CODEX-LICENSE` 的 Apache-2.0，原始 OpenAI 归属见扩展的 `NOTICE`。预编译模块包含其他许可证下的第三方代码，不能把整个二进制只视为 Apache-2.0 或 MIT。

`third-party/dependencies.json` 列出各 crate 的版本、许可证、原始下载地址和校验和；完整许可证文本位于 `third-party/licenses/`。MPL-2.0 覆盖的 Symphonia crate 未经修改，其对应源代码完整压缩包随产物一起提供，位于 `third-party/source/*.crate`，可用 `tar -xzf` 解开。接收者可按 MPL-2.0 使用、修改和再发布这些文件。适配层的独立文件不改变这些权利。

Rust 标准库及其组件的归属和许可证位于 `third-party/rust/`。发布构建复制本目录的源文件、Cargo.lock、manifest、许可证和对应源代码，不复制本机编译缓存。
