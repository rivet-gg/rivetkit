use anyhow::Result;

use crate::protocol::ToServer;

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

    pub fn get_default_serializer(&self) -> fn(&ToServer) -> Result<Vec<u8>> {
        match self {
            EncodingKind::Json => json_serialize,
            EncodingKind::Cbor => cbor_serialize
        }
    }
}

fn json_serialize(value: &ToServer) -> Result<Vec<u8>> {
    let msg = serde_json::to_vec(value)?;

    Ok(msg)
}

fn cbor_serialize(msg: &ToServer) -> Result<Vec<u8>> {
    let msg = serde_cbor::to_vec(msg)?;

    Ok(msg)
}
