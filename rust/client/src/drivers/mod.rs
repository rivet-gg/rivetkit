use std::sync::Arc;

use anyhow::Result;
use serde_json::Value;
use tokio::{sync::mpsc, task::{AbortHandle, JoinHandle}};
use urlencoding::encode;
use crate::{encoding::EncodingKind, protocol};

pub mod ws;
pub mod sse;

const MAX_CONN_PARAMS_SIZE: usize = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DriverStopReason {
    UserAborted,
    ServerDisconnect,
    ServerError,
    TaskError,
}

pub(crate) type MessageToClient = Arc<protocol::ToClient>;
pub(crate) type MessageToServer = Arc<protocol::ToServer>;

pub(crate) struct DriverHandle {
    abort_handle: AbortHandle,
    sender: mpsc::Sender<MessageToServer>,
}

impl DriverHandle {
    pub fn new(
        sender: mpsc::Sender<MessageToServer>,
        abort_handle: AbortHandle
    ) -> Self {
        Self {
            sender,
            abort_handle,
        }
    }

    pub async fn send(&self, msg: Arc<protocol::ToServer>) -> Result<()> {
        self.sender.send(msg).await?;

        Ok(())
    }

    pub fn disconnect(&self) {
        self.abort_handle.abort();
    }
}

impl Drop for DriverHandle {
    fn drop(&mut self) {
        self.disconnect()
    }
}

#[derive(Debug, Clone, Copy)]
pub enum TransportKind {
    WebSocket,
    Sse,
}

impl TransportKind {
    pub(crate) async fn connect(
        &self,
        endpoint: String,
        encoding_kind: EncodingKind,
        parameters: &Option<Value>
    ) -> Result<(
        DriverHandle,
        mpsc::Receiver<MessageToClient>,
        JoinHandle<DriverStopReason>
    )> {
        match *self {
            TransportKind::WebSocket => ws::connect(endpoint, encoding_kind, parameters).await,
            TransportKind::Sse => sse::connect(endpoint, encoding_kind, parameters).await
        }
    }
}

fn build_conn_url(
    endpoint: &str,
    transport_kind: &TransportKind,
    encoding_kind: EncodingKind,
    params: &Option<Value>
) -> Result<String> {
    let connect_path = {
        match transport_kind {
            TransportKind::WebSocket => "websocket",
            TransportKind::Sse => "sse"
        }
    };

    let endpoint = match transport_kind {
        TransportKind::WebSocket => {
            endpoint.to_string().replace("http://", "ws://").replace("https://", "wss://")
        },
        TransportKind::Sse => {
            endpoint.to_string()
        }
    };

    let Some(params) = params else {
        return Ok(format!("{}/connect/{}?encoding={}", endpoint, connect_path, encoding_kind.as_str()));
    };

    let params_str = serde_json::to_string(params)?;
    if params_str.len() > MAX_CONN_PARAMS_SIZE {
        return Err(anyhow::anyhow!("Connection parameters too long"));
    }

    let params_str = encode(&params_str);

    Ok(format!("{}/connect/{}?encoding={}&params={}", endpoint, connect_path, encoding_kind.as_str(), params_str))
}
