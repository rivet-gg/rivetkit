use std::sync::Arc;
use eventsource_client::{BoxStream, Client, ClientBuilder, ReconnectOptionsBuilder, SSE};
use futures_util::StreamExt;
use serde_json::Value;
use tokio::sync::mpsc;
use anyhow::{Context, Result};
use base64::prelude::*;
use tokio::task::JoinHandle;
use tracing::debug;

use crate::encoding::EncodingKind;
use crate::protocol::{ToClient, ToServer, ToClientBody};

use super::{build_conn_url, DriverHandle, DriverStopReason, MessageToClient, MessageToServer, TransportKind};

#[derive(Debug, Clone, PartialEq, Eq)]
struct ConnectionDetails {
    id: String,
    token: String,
}

pub(crate) async fn connect(endpoint: String, encoding_kind: EncodingKind, parameters: &Option<Value>) -> Result<(
    DriverHandle,
    mpsc::Receiver<MessageToClient>,
    JoinHandle<DriverStopReason>
)> {
    let url = build_conn_url(&endpoint, &TransportKind::Sse, encoding_kind, parameters)?;

    let client = ClientBuilder::for_url(&url)?
        .reconnect(ReconnectOptionsBuilder::new(false).build())
        .build();

    let (in_tx, in_rx) = mpsc::channel::<MessageToClient>(32);
    let (out_tx, out_rx) = mpsc::channel::<MessageToServer>(32);

    let task = tokio::spawn(start(
        client,
        endpoint,
        encoding_kind,
        in_tx,
        out_rx
    ));

    let handle = DriverHandle::new(out_tx, task.abort_handle());
    Ok((handle, in_rx, task))
}

async fn start(
    client: impl Client,
    endpoint: String,
    encoding_kind: EncodingKind,
    in_tx: mpsc::Sender<MessageToClient>,
    mut out_rx: mpsc::Receiver<MessageToServer>
) -> DriverStopReason {
    let serialize = get_serializer(encoding_kind);
    let deserialize = get_deserializer(encoding_kind);

    let mut stream = client.stream();

    let conn = match do_handshake(&mut stream, &deserialize, &in_tx).await {
        Ok(conn) => conn,
        Err(reason) => {
            debug!("Failed to connect: {:?}", reason);
            return reason;
        }
    };

    loop {
        tokio::select! {
            msg = out_rx.recv() => {
                let Some(msg) = msg else {
                    return DriverStopReason::UserAborted;
                };

                let msg = match serialize(&msg) {
                    Ok(msg) => msg,
                    Err(e) => {
                        debug!("Failed to serialize {:?} {:?}", msg, e);
                        continue;
                    }
                };

                // Add connection ID and token to the request URL
                let request_url = format!(
                    "{}/connections/{}/message?encoding={}&connectionToken={}", 
                    endpoint, conn.id, encoding_kind.as_str(), urlencoding::encode(&conn.token)
                );
            
                // Handle response
                let resp = reqwest::Client::new()
                    .post(request_url)
                    .body(msg)
                    .send()
                    .await;

                match resp {
                    Ok(resp) => {
                        if !resp.status().is_success() {
                            debug!("Failed to send message: {:?}", resp);
                        }

                        if let Ok(t) = resp.text().await {
                            debug!("Response: {:?}", t);
                        }
                    },
                    Err(e) => {
                        debug!("Failed to send message: {:?}", e);
                    }
                }
            },
            // Handle sse incoming
            msg = stream.next() => {
                let Some(msg) = msg else {
                    debug!("Receiver dropped");
                    return DriverStopReason::ServerDisconnect;
                };

                match msg {
                    Ok(msg) => match msg {
                        SSE::Comment(comment) => debug!("Sse comment: {}", comment),
                        SSE::Connected(_) => debug!("warning: received sse connection past-handshake"),
                        SSE::Event(event) => {
                            // println!("POST INIT event coming in: {:?}", event.data);
                            let msg = match deserialize(&event.data) {
                                Ok(msg) => msg,
                                Err(e) => {
                                    debug!("Failed to deserialize {:?} {:?}", event, e);
                                    continue;
                                }
                            };

                            if let Err(e) = in_tx.send(Arc::new(msg)).await {
                                debug!("Receiver in_rx dropped {:?}", e);
                                return DriverStopReason::UserAborted;
                            }
                        },
                    }
                    Err(e) => {
                        debug!("Sse error: {}", e);
                        return DriverStopReason::ServerError;
                    }
                }
            }
        }
    }
}

async fn do_handshake(
    stream: &mut BoxStream<eventsource_client::Result<SSE>>,
    deserialize: &impl Fn(&str) -> Result<ToClient>,
    in_tx: &mpsc::Sender<MessageToClient>
) -> Result<ConnectionDetails, DriverStopReason> {

    loop {
        tokio::select! {
            // Handle sse incoming
            msg = stream.next() => {
                let Some(msg) = msg else {
                    debug!("Receiver dropped");
                    return Err(DriverStopReason::ServerDisconnect);
                };

                match msg {
                    Ok(msg) => match msg {
                        SSE::Comment(comment) => debug!("Sse comment {:?}", comment),
                        SSE::Connected(_) => debug!("Connected Sse"),
                        SSE::Event(event) => {
                            let msg = match deserialize(&event.data) {
                                Ok(msg) => msg,
                                Err(e) => {
                                    debug!("Failed to deserialize {:?} {:?}", event, e);
                                    continue;
                                }
                            };

                            let msg = Arc::new(msg);

                            if let Err(e) = in_tx.send(msg.clone()).await {
                                debug!("Receiver in_rx dropped {:?}", e);
                                return Err(DriverStopReason::UserAborted);
                            }

                            // Wait until we get an Init packet
                            let ToClientBody::Init { i } = &msg.b else {
                                continue;
                            };

                            // Mark handshake complete
                            let conn_id = &i.ci;
                            let conn_token = &i.ct;

                            return Ok(ConnectionDetails {
                                id: conn_id.clone(),
                                token: conn_token.clone()
                            })
                        },
                    }
                    Err(e) => {
                        eprintln!("Sse error: {}", e);
                        return Err(DriverStopReason::ServerError);
                    }
                }
            }
        }
    }
}


fn get_serializer(encoding_kind: EncodingKind) -> impl Fn(&ToServer) -> Result<Vec<u8>> {
    encoding_kind.get_default_serializer()
}

fn get_deserializer(encoding_kind: EncodingKind) -> impl Fn(&str) -> Result<ToClient> {
    match encoding_kind {
        EncodingKind::Json => json_deserialize,
        EncodingKind::Cbor => cbor_deserialize
    }
}

fn json_deserialize(value: &str) -> Result<ToClient> {
    let msg = serde_json::from_str::<ToClient>(value)?;

    Ok(msg)
}

fn cbor_deserialize(msg: &str) -> Result<ToClient> {
    let msg = BASE64_STANDARD.decode(msg.as_bytes()).context("base64 failure:")?;
    let msg = serde_cbor::from_slice::<ToClient>(&msg).context("serde failure:")?;

    Ok(msg)
}
