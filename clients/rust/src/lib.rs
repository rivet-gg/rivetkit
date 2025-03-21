// cargo test -- --nocapture

mod backoff;
pub mod client;
pub mod drivers;
pub mod encoding;
pub mod handle;
pub mod protocol;

pub use client::{Client, CreateOptions, GetOptions, GetWithIdOptions};
pub use drivers::TransportKind;
pub use encoding::EncodingKind;
