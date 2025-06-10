use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use tracing::debug;

use crate::{
    protocol::to_server,
    protocol::to_client,
    EncodingKind
};

use super::{
    DriverConnectArgs, DriverConnection, DriverHandle, DriverStopReason, MessageToClient, MessageToServer
};

fn build_connection_url(args: &DriverConnectArgs) -> Result<String> {
    let actor_query_string = serde_json::to_string(&args.query)?;
    // TODO: Should replace http:// only at the start of the string
    let url = args.endpoint
        .to_string()
        .replace("http://", "ws://")
        .replace("https://", "wss://");

    let url = format!(
        "{}/actors/connect/websocket?encoding={}&query={}",
        url,
        args.encoding_kind.as_str(),
        urlencoding::encode(&actor_query_string)
    );

    Ok(url)
}


pub(crate) async fn connect(args: DriverConnectArgs) -> Result<DriverConnection> {
    let url = build_connection_url(&args)?;

    debug!("Connecting to: {}", url);

    let (ws, _res) = tokio_tungstenite::connect_async(url)
        .await
        .context("Failed to connect to WebSocket")?;

    let (in_tx, in_rx) = mpsc::channel::<MessageToClient>(32);
    let (out_tx, out_rx) = mpsc::channel::<MessageToServer>(32);

    let task = tokio::spawn(start(ws, args.encoding_kind, in_tx, out_rx));
    let handle = DriverHandle::new(out_tx, task.abort_handle());

    handle.send(Arc::new(
        to_server::ToServer {
            b: to_server::ToServerBody::Init {
                i: to_server::Init {
                    p: args.parameters
                }
            },
        }
    )).await?;

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
                    debug!("Sender dropped");
                    return DriverStopReason::UserAborted;
                };

                let msg = match serialize(&msg) {
                    Ok(msg) => msg,
                    Err(e) => {
                        debug!("Failed to serialize message: {:?}", e);
                        continue;
                    }
                };

                if let Err(e) = ws_sink.send(msg).await {
                    debug!("Failed to send message: {:?}", e);
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
                                debug!("Failed to parse message: {:?}", msg);
                                continue;
                            };

                            if let Err(e) = in_tx.send(Arc::new(msg)).await {
                                debug!("Failed to send text message: {}", e);
                                // failure to send means user dropped incoming receiver
                                return DriverStopReason::UserAborted;
                            }
                        },
                        Message::Close(_) => {
                            debug!("Close message");
                            return DriverStopReason::ServerDisconnect;
                        },
                        _ => {
                            debug!("Invalid message type received");
                        }
                    }
                    Err(e) => {
                        debug!("WebSocket error: {}", e);
                        return DriverStopReason::ServerError;
                    }
                }
            }
        }
    }
}

fn get_msg_deserializer(encoding_kind: EncodingKind) -> fn(&Message) -> Result<to_client::ToClient> {
    match encoding_kind {
        EncodingKind::Json => json_msg_deserialize,
        EncodingKind::Cbor => cbor_msg_deserialize,
    }
}

fn get_msg_serializer(encoding_kind: EncodingKind) -> fn(&to_server::ToServer) -> Result<Message> {
    match encoding_kind {
        EncodingKind::Json => json_msg_serialize,
        EncodingKind::Cbor => cbor_msg_serialize,
    }
}

fn json_msg_deserialize(value: &Message) -> Result<to_client::ToClient> {
    match value {
        Message::Text(text) => Ok(serde_json::from_str(text)?),
        Message::Binary(bin) => Ok(serde_json::from_slice(bin)?),
        _ => Err(anyhow::anyhow!("Invalid message type")),
    }
}

fn cbor_msg_deserialize(value: &Message) -> Result<to_client::ToClient> {
    match value {
        Message::Binary(bin) => Ok(serde_cbor::from_slice(bin)?),
        Message::Text(text) => Ok(serde_cbor::from_slice(text.as_bytes())?),
        _ => Err(anyhow::anyhow!("Invalid message type")),
    }
}

fn json_msg_serialize(value: &to_server::ToServer) -> Result<Message> {
    Ok(Message::Text(serde_json::to_string(value)?.into()))
}

fn cbor_msg_serialize(value: &to_server::ToServer) -> Result<Message> {
    Ok(Message::Binary(serde_cbor::to_vec(value)?.into()))
}
