use anyhow::{Result};
use base64::prelude::*;
use eventsource_client::{BoxStream, Client, ClientBuilder, ReconnectOptionsBuilder, SSE};
use futures_util::StreamExt;
use reqwest::header::USER_AGENT;
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::debug;

use crate::{
    common::{EncodingKind, HEADER_ACTOR_ID, HEADER_ACTOR_QUERY, HEADER_CONN_ID, HEADER_CONN_PARAMS, HEADER_CONN_TOKEN, HEADER_ENCODING, USER_AGENT_VALUE},
    protocol::{to_client, to_server}
};

use super::{
    DriverConnectArgs, DriverConnection, DriverHandle, DriverStopReason, MessageToClient, MessageToServer
};

#[derive(Debug, Clone, PartialEq, Eq)]
struct ConnectionDetails {
    actor_id: String,
    id: String,
    token: String,
}


struct Context {
    conn: ConnectionDetails,
    encoding_kind: EncodingKind,
    endpoint: String,
}

pub(crate) async fn connect(args: DriverConnectArgs) -> Result<DriverConnection> {
    let endpoint = format!("{}/actors/connect/sse", args.endpoint);

    let params_string = match args.parameters {
        Some(p) => Some(serde_json::to_string(&p)).transpose(),
        None => Ok(None),
    }?;

    let client = ClientBuilder::for_url(&endpoint)?
        .header(USER_AGENT.as_str(), USER_AGENT_VALUE)?
        .header(HEADER_ENCODING, args.encoding_kind.as_str())?
        .header(HEADER_ACTOR_QUERY, serde_json::to_string(&args.query)?.as_str())?;

    let client = match params_string {
        Some(p) => client.header(HEADER_CONN_PARAMS, p.as_str())?,
        None => client,
    };
    let client = client.reconnect(ReconnectOptionsBuilder::new(false).build())
        .build();

    let (in_tx, in_rx) = mpsc::channel::<MessageToClient>(32);
    let (out_tx, out_rx) = mpsc::channel::<MessageToServer>(32);

    let task = tokio::spawn(start(client, args.endpoint, args.encoding_kind, in_tx, out_rx));

    let handle = DriverHandle::new(out_tx, task.abort_handle());
    Ok((handle, in_rx, task))
}

async fn sse_send_msg(ctx: &Context, msg: MessageToServer) -> Result<String> {
    let msg = serialize(ctx.encoding_kind, &msg)?;

    // Add connection ID and token to the request URL
    let request_url = format!(
        "{}/actors/message",
        ctx.endpoint
    );

    let res = reqwest::Client::new()
        .post(request_url)
        .body(msg)
        .header(USER_AGENT, USER_AGENT_VALUE)
        .header(HEADER_ENCODING, ctx.encoding_kind.as_str())
        .header(HEADER_ACTOR_ID, ctx.conn.actor_id.as_str())
        .header(HEADER_CONN_ID, ctx.conn.id.as_str())
        .header(HEADER_CONN_TOKEN, ctx.conn.token.as_str())
        .send()
        .await?;


    if !res.status().is_success() {
        return Err(anyhow::anyhow!("Failed to send message: {:?}", res));
    }

    let res = res.text().await?;
    
    Ok(res)
}

async fn start(
    client: impl Client,
    endpoint: String,
    encoding_kind: EncodingKind,
    in_tx: mpsc::Sender<MessageToClient>,
    mut out_rx: mpsc::Receiver<MessageToServer>,
) -> DriverStopReason {
    let mut stream = client.stream();

    let ctx = Context {
        conn: match do_handshake(&mut stream, encoding_kind, &in_tx).await {
            Ok(conn) => conn,
            Err(reason) => return reason
        },
        encoding_kind,
        endpoint,
    };

    debug!("Handshake completed successfully");

    loop {
        tokio::select! {
            // Handle outgoing messages
            msg = out_rx.recv() => {
                let Some(msg) = msg else {
                    return DriverStopReason::UserAborted;
                };

                let res = match sse_send_msg(&ctx, msg).await {
                    Ok(res) => res,
                    Err(e) => {
                        debug!("Failed to send message: {:?}", e);
                        continue;
                    }
                };

                debug!("Response: {:?}", res);
            },
            msg = stream.next() => {
                let Some(msg) = msg else {
                    // Receiver dropped
                    return DriverStopReason::ServerDisconnect;
                };

                match msg {
                    Ok(msg) => match msg {
                        SSE::Comment(comment) => debug!("Sse comment: {}", comment),
                        SSE::Connected(_) => debug!("warning: received sse connection past-handshake"),
                        SSE::Event(event) => {
                            let msg = match deserialize(encoding_kind, &event.data) {
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
    encoding_kind: EncodingKind,
    in_tx: &mpsc::Sender<MessageToClient>,
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
                            let msg = match deserialize(encoding_kind, &event.data) {
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
                            let to_client::ToClientBody::Init { i } = &msg.b else {
                                continue;
                            };

                            // Mark handshake complete
                            return Ok(ConnectionDetails {
                                actor_id: i.ai.to_string(),
                                id: i.ci.clone(),
                                token: i.ct.clone()
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

fn deserialize(encoding_kind: EncodingKind, msg: &str) -> Result<to_client::ToClient> {
    match encoding_kind {
        EncodingKind::Json => {
            Ok(serde_json::from_str::<to_client::ToClient>(msg)?)
        },
        EncodingKind::Cbor => {
            let msg = serde_cbor::from_slice::<to_client::ToClient>(
                &BASE64_STANDARD.decode(msg.as_bytes())?
            )?;

            Ok(msg)
        }
    }
}

fn serialize(encoding_kind: EncodingKind, msg: &to_server::ToServer) -> Result<Vec<u8>> {
    match encoding_kind {
        EncodingKind::Json => Ok(serde_json::to_vec(msg)?),
        EncodingKind::Cbor => Ok(serde_cbor::to_vec(msg)?),
    }
}

