// Adapted from OpenAI Codex 0.154.0 context_manager/history.rs.
mod audio;
mod context;
use base64::Engine;
use base64::prelude::BASE64_STANDARD;

fn parse_base64_data_url<'a>(url: &'a str, media_type_prefix: &str) -> Option<&'a str> {
    if !url.get(.."data:".len()).is_some_and(|prefix| prefix.eq_ignore_ascii_case("data:")) {
        return None;
    }
    let comma_index = url.find(',')?;
    let metadata = &url[..comma_index];
    let payload = &url[comma_index + 1..];
    let mut metadata_parts = metadata["data:".len()..].split(';');
    let mime_type = metadata_parts.next().unwrap_or_default();
    let has_base64_marker = metadata_parts.any(|part| part.eq_ignore_ascii_case("base64"));
    if !mime_type.get(..media_type_prefix.len()).is_some_and(|prefix| prefix.eq_ignore_ascii_case(media_type_prefix)) || !has_base64_marker {
        return None;
    }
    Some(payload)
}

pub fn original_image_bytes(url: &str, platform_features: u32) -> Option<u32> {
    let bytes = BASE64_STANDARD.decode(parse_base64_data_url(url, "image/")?).ok()?;
    // arboard enables TIFF on macOS and BMP on Windows in the full CLI build.
    match image::guess_format(&bytes).ok()? {
        image::ImageFormat::Tiff if platform_features & 1 == 0 => return None,
        image::ImageFormat::Bmp if platform_features & 2 == 0 => return None,
        _ => {}
    }
    let dynamic = image::load_from_memory(&bytes).ok()?;
    let patches = (u64::from(dynamic.width()) + 31) / 32 * ((u64::from(dynamic.height()) + 31) / 32);
    Some(patches.min(10000) as u32 * 4)
}

#[no_mangle]
pub extern "C" fn allocate(length: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; length].into_boxed_slice()) as *mut u8
}

/// The pointer and length must be an allocation returned by allocate.
#[no_mangle]
pub unsafe extern "C" fn release(pointer: *mut u8, length: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(pointer, length)));
}

/// The caller must provide a valid allocated UTF-8 buffer.
#[no_mangle]
pub unsafe extern "C" fn image_bytes(pointer: *const u8, length: usize, platform_features: u32) -> i32 {
    let bytes = std::slice::from_raw_parts(pointer, length);
    std::str::from_utf8(bytes).ok().and_then(|url| original_image_bytes(url, platform_features)).map_or(-1, |value| value as i32)
}

/// The caller must provide a valid allocated UTF-8 buffer.
#[no_mangle]
pub unsafe extern "C" fn context_hook(pointer: *const u8, length: usize) -> i32 {
    let bytes = std::slice::from_raw_parts(pointer, length);
    i32::from(std::str::from_utf8(bytes).is_ok_and(context::is_hook_prompt))
}

/// The caller must provide a valid allocated UTF-8 buffer.
#[no_mangle]
pub unsafe extern "C" fn context_inter_agent(pointer: *const u8, length: usize) -> i32 {
    let bytes = std::slice::from_raw_parts(pointer, length);
    i32::from(std::str::from_utf8(bytes).is_ok_and(context::is_inter_agent))
}

/// The caller must provide a valid allocated UTF-8 buffer.
#[no_mangle]
pub unsafe extern "C" fn audio_duration(pointer: *const u8, length: usize) -> f64 {
    let bytes = std::slice::from_raw_parts(pointer, length);
    std::str::from_utf8(bytes).ok().and_then(audio::audio_duration_seconds).unwrap_or(-1.0)
}
