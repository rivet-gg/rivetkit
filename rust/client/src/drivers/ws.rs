use std::sync::Arc;
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use anyhow::{Result, Context};

use crate::encoding::EncodingKind;
use crate::protocol::{ToClient, ToServer};

use super::{build_conn_url, DriverHandle, DriverStopReason, MessageToClient, MessageToServer, TransportKind};

pub(crate) async fn connect(endpoint: String, encoding_kind: EncodingKind, parameters: &Option<Value>) -> Result<(
    DriverHandle,
    mpsc::Receiver<MessageToClient>,
    JoinHandle<DriverStopReason>
)> {
    let url = build_conn_url(&endpoint, &TransportKind::WebSocket, encoding_kind, parameters)?;

    let (ws, _res) = tokio_tungstenite::connect_async(url)
        .await
        .context("Failed to connect to WebSocket")?;

    let (in_tx, in_rx) = mpsc::channel::<MessageToClient>(32);
    let (out_tx, out_rx) = mpsc::channel::<MessageToServer>(32);
    let task = tokio::spawn(start(
        ws,
        encoding_kind,
        in_tx,
        out_rx
    ));

    let handle = DriverHandle::new(out_tx, task.abort_handle());

    Ok((handle, in_rx, task))
}
    
async fn start(
    ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    encoding_kind: EncodingKind,
    in_tx: mpsc::Sender<MessageToClient>,
    mut out_rx: mpsc::Receiver<MessageToServer>,
) -> DriverStopReason {
    let (mut ws_sink, mut ws_stream) = ws.split(); 

    let serialize = get_msg_serializer(encoding_kind);
    let deserialize = get_msg_deserializer(encoding_kind);
    
    loop {
        tokio::select! {
            // Dispatch ws outgoing queue
            msg = out_rx.recv() => {
                // If the sender is dropped, break the loop
                let Some(msg) = msg else {
                    println!("Sender dropped");
                    return DriverStopReason::UserAborted;
                };

                let msg = match serialize(&msg) {
                    Ok(msg) => msg,
                    Err(e) => {
                        eprintln!("Failed to serialize message: {:?}", e);
                        continue;
                    }
                };

                if let Err(e) = ws_sink.send(msg).await {
                    eprintln!("Failed to send message: {:?}", e);
                    continue;
                }
            },
            // Handle ws incoming
            msg = ws_stream.next() => {
                let Some(msg) = msg else {
                    println!("Receiver dropped");
                    return DriverStopReason::ServerDisconnect;
                };

                match msg {
                    Ok(msg) => match msg {
                        Message::Text(_) | Message::Binary(_) => {
                            let Ok(msg) = deserialize(&msg) else {
                                eprintln!("Failed to parse message, {:?}", msg);
                                continue;
                            };

                            if let Err(e) = in_tx.send(Arc::new(msg)).await {
                                eprintln!("Failed to send text message: {}", e);
                                // failure to send means user dropped incoming receiver
                                return DriverStopReason::UserAborted;
                            }
                        },
                        Message::Close(_) => {
                            eprintln!("Close message");
                            return DriverStopReason::ServerDisconnect;
                        },
                        _ => {
                            eprintln!("Invalid message type");
                        }
                    }
                    Err(e) => {
                        eprintln!("WebSocket error: {}", e);
                        return DriverStopReason::ServerError;
                    }
                }
            }
        }
    }
}

fn get_msg_deserializer(encoding_kind: EncodingKind) -> fn(&Message) -> Result<ToClient> {
    match encoding_kind {
        EncodingKind::Json => json_msg_deserialize,
        EncodingKind::Cbor => cbor_msg_deserialize
    }
}

fn get_msg_serializer(encoding_kind: EncodingKind) -> fn(&ToServer) -> Result<Message> {
    match encoding_kind {
        EncodingKind::Json => json_msg_serialize,
        EncodingKind::Cbor => cbor_msg_serialize
    }
}

fn json_msg_deserialize(value: &Message) -> Result<ToClient> {
    match value {
        Message::Text(text) => Ok(serde_json::from_str(text)?),
        Message::Binary(bin) => Ok(serde_json::from_slice(bin)?),
        _ => Err(anyhow::anyhow!("Invalid message type"))
    }
}

fn cbor_msg_deserialize(value: &Message) -> Result<ToClient> {
    match value {
        Message::Binary(bin) => Ok(serde_cbor::from_slice(bin)?),
        Message::Text(text) => Ok(serde_cbor::from_slice(text.as_bytes())?),
        _ => Err(anyhow::anyhow!("Invalid message type"))
    }
}

fn json_msg_serialize(value: &ToServer) -> Result<Message> {
    Ok(Message::Text(
        serde_json::to_string(value)?.into()
    ))
}

fn cbor_msg_serialize(value: &ToServer) -> Result<Message> {
    Ok(Message::Binary(
        serde_cbor::to_vec(value)?.into()
    ))
}
