# Media fixtures

这些文件由本地工具合成，不包含用户图片或录音。

## Images

`patch-boundary.*` 是 64×33 的 RGB 纯色图片，颜色为 `(12, 34, 56)`，用 Pillow 12.3.0 生成。它们验证 32px patch 在宽、高两个维度分别向上取整，结果为 4 patches。`large-original.png` 使用同一颜色，尺寸 4096×4096，验证 10000 patches 上限和解码后大堆内存回收。

```python
from PIL import Image
from pathlib import Path
root = Path("extensions/codex-compact/__tests__/fixtures/media")
im = Image.new("RGB", (64, 33), (12, 34, 56))
for extension, format in [("png", "PNG"), ("jpg", "JPEG"), ("gif", "GIF"), ("webp", "WEBP"), ("tiff", "TIFF"), ("bmp", "BMP")]:
    im.save(root / f"patch-boundary.{extension}", format=format)
Image.new("RGB", (4096, 4096), (12, 34, 56)).save(root / "large-original.png")
```

## Audio

`one-second.wav` 是 Python 3.12 标准库 `wave` 写入的 1 秒、8000Hz、单声道、16bit PCM 静音，共 8000 个零采样。其他容器由 FFmpeg 8.1.2 转码生成。MP3、M4A 的编码延迟和容器时间信息可能改变探测时长，测试不假定所有文件都恰好 10 tokens，而是与固定版本的原始 Rust estimator 比较。

```python
import wave
with wave.open("extensions/codex-compact/__tests__/fixtures/media/one-second.wav", "wb") as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(8000)
    audio.writeframes(b"\0\0" * 8000)
```

```sh
ffmpeg -nostdin -v error -i one-second.wav -c:a libmp3lame one-second.mp3
ffmpeg -nostdin -v error -i one-second.wav -c:a aac one-second.m4a
ffmpeg -nostdin -v error -i one-second.wav -c:a libopus one-second.webm
ffmpeg -nostdin -v error -i one-second.wav -c:a libopus one-second.ogg
```

## Extreme duration

`extreme-duration.m4a` 从 `one-second.m4a` 复制，递归重写 moov/trak/mdia/minf/stbl 的 box size；将 mdhd 的 timescale 设为 1，把 stts 改为一个条目，sample_count 和 sample_delta 都设为 `0xffffffff`。音频采样数据未扩充。这个损坏的时长声明仍能被原版 Symphonia 探测，验证 Codex 的 u64 token 上限、i64 bytes 上限以及多个项目相加的饱和语义，不把恶意元数据当作无限 token。

重建音频容器可能改变序列号或编码器元数据。修改 fixture 后必须重跑 `scripts/codex-compact-full-vectors.mjs`，它记录输入指纹和原始 Rust 结果，不能直接修改预期数字。
