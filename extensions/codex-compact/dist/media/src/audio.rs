// Adapted from OpenAI Codex 0.154.0 utils/audio/src/lib.rs, Apache-2.0.
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use std::io::Cursor;
use symphonia::core::formats::FormatOptions;
use symphonia::core::formats::TrackType;
use symphonia::core::formats::probe::Hint;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

fn canonical_audio_mime(mime: &str) -> Option<&'static str> {
    if mime.eq_ignore_ascii_case("audio/wav")
        || mime.eq_ignore_ascii_case("audio/x-wav")
        || mime.eq_ignore_ascii_case("audio/wave")
        || mime.eq_ignore_ascii_case("audio/vnd.wave")
    {
        Some("audio/wav")
    } else if mime.eq_ignore_ascii_case("audio/mpeg") || mime.eq_ignore_ascii_case("audio/mp3") {
        Some("audio/mpeg")
    } else if mime.eq_ignore_ascii_case("audio/mp4")
        || mime.eq_ignore_ascii_case("audio/m4a")
        || mime.eq_ignore_ascii_case("audio/x-m4a")
    {
        Some("audio/mp4")
    } else if mime.eq_ignore_ascii_case("audio/webm") {
        Some("audio/webm")
    } else if mime.eq_ignore_ascii_case("audio/ogg") {
        Some("audio/ogg")
    } else {
        None
    }
}

pub fn audio_duration_seconds(audio_url: &str) -> Option<f64> {
    let (metadata, payload) = audio_url.split_once(',')?;
    let metadata = metadata.get("data:".len()..)?;
    let mut metadata_parts = metadata.split(';');
    let canonical_mime = canonical_audio_mime(metadata_parts.next()?)?;
    if !metadata_parts.any(|part| part.eq_ignore_ascii_case("base64")) {
        return None;
    }

    let bytes = BASE64_STANDARD.decode(payload).ok()?;
    let media_source = MediaSourceStream::new(Box::new(Cursor::new(bytes)), Default::default());
    let mut hint = Hint::new();
    hint.mime_type(canonical_mime);
    let format = symphonia::default::get_probe()
        .probe(&hint, media_source, FormatOptions::default(), MetadataOptions::default())
        .ok()?;
    let track = format.default_track(TrackType::Audio)?;
    let timing = track.time_base.zip(track.duration).or_else(|| {
        format.media_info().time_base.zip(format.media_info().duration)
    });
    let (time_base, duration) = timing?;
    let duration_seconds =
        duration.get() as f64 * f64::from(time_base.numer.get()) / f64::from(time_base.denom.get());
    duration_seconds.is_finite().then_some(duration_seconds)
}
