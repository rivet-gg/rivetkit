#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncodingKind {
    Json,
    Cbor
}

impl EncodingKind {
    pub fn as_str(&self) -> &str {
        match self {
            EncodingKind::Json => "json",
            EncodingKind::Cbor => "cbor"
        }
    }
}
