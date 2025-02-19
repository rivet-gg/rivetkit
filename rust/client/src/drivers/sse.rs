use std::sync::Arc;
use eventsource_client::{Client, ClientBuilder, SSE};
use futures_util::StreamExt;
use tokio::sync::{mpsc, Mutex};
use anyhow::{Context, Result};
use base64::prelude::*;

use crate::encoding::EncodingKind;
use crate::protocol::{ToClient, ToServer, ToClientBody};


pub struct SseSender {
    tx: mpsc::Sender<Arc<ToServer>>,
}

// TODO: Maybe turn this into a Sink
impl SseSender {
    pub async fn send_raw(&self, msg: Arc<ToServer>) -> Result<()> {
        self.tx.send(msg)
            .await
            .context("Failed to send message")?;

        Ok(())
    }
}

pub struct SseReceiver {
    rx: mpsc::Receiver<Arc<ToClient>>,
}

// TODO: Maybe turn this into a StreamExt
impl SseReceiver {  
    pub async fn recv_msg(&mut self) -> Option<Arc<ToClient>> {
        self.rx.recv().await
    }
}

#[derive(Debug, Clone)]
struct ConnectionDetails {
    id: String,
    token: String,
}

enum SseConnectionInner {
    Opened(ConnectionDetails),
    Closed(),
}

impl SseConnectionInner {
    pub fn new() -> Arc<Mutex<Self>> {
        Arc::new(Mutex::new(SseConnectionInner::Closed()))
    }
}

type SseConnection = Arc<Mutex<SseConnectionInner>>;

pub struct SseDriver {
    endpoint: String,
    encoding_kind: EncodingKind,
    connection: SseConnection,
}

impl SseDriver {
    pub fn new(endpoint: String, encoding_kind: EncodingKind) -> Result<Self> {
        Ok(SseDriver {
            endpoint,
            encoding_kind,
            connection: SseConnectionInner::new(),
        })
    }

    pub async fn connect(
        &self
    ) -> Result<(SseSender, SseReceiver)> {
        let url = self.build_conn_url();
        println!("sse url: {}", url);
        let client = ClientBuilder::for_url(&url)?
            .build();

        let (in_tx, in_rx) = mpsc::channel::<Arc<ToClient>>(32);
        let (out_tx, out_rx) = mpsc::channel::<Arc<ToServer>>(32);

        tokio::spawn(SseDriver::start(
            client,
            self.endpoint.clone(),
            self.encoding_kind,
            self.connection.clone(),
            in_tx,
            out_rx
        ));

        Ok((SseSender { tx: out_tx }, SseReceiver { rx: in_rx }))
    }

    async fn start(
        client: impl Client,
        endpoint: String,
        encoding_kind: EncodingKind,
        connection: SseConnection,
        in_tx: mpsc::Sender<Arc<ToClient>>,
        mut out_rx: mpsc::Receiver<Arc<ToServer>>,
    ) {
        let serialize = match encoding_kind {
            EncodingKind::Json => json_serialize,
            EncodingKind::Cbor => cbor_serialize
        };

        let deserialize = match encoding_kind {
            EncodingKind::Json => json_deserialize,
            EncodingKind::Cbor => cbor_deserialize
        };

        let mut stream = client.stream();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    // Dispatch ws outgoing queue
                    // TODO: this shouldn't receive if connection is closed...
                    msg = out_rx.recv() => {
                        let Some(msg) = msg else {
                            println!("Sender dropped");
                            break;
                        };

                        let msg = match serialize(&msg) {
                            Ok(msg) => msg,
                            Err(e) => {
                                eprintln!("Failed to serialize {:?} {:?}", msg, e);
                                continue;
                            }
                        };

                        let SseConnectionInner::Opened(ConnectionDetails {
                            id: connection_id, token: connection_token
                        }) = &*connection.lock().await else {
                            eprintln!("Connection not opened");
                            continue;
                        };

                        // Add connection ID and token to the request URL
                        let request_url = format!(
                            "{}/connections/{}/message?encoding={}&connectionToken={}", 
                            endpoint, connection_id, encoding_kind.as_str(), urlencoding::encode(&connection_token)
                        );
                    
                        // Handle response
                        let resp = reqwest::Client::new()
                            .post(request_url)
                            .body(msg)
                            .send()
                            .await;
                    
                        println!("Response: {:?}", resp);
                    },
                    // Handle ws incoming
                    msg = stream.next() => {
                        let Some(msg) = msg else {
                            println!("Receiver dropped");
                            break;
                        };

                        match msg {
                            Ok(msg) => match msg {
                                SSE::Comment(comment) => {
                                    eprintln!("Comment: {}", comment);
                                },
                                SSE::Event(event) => {
                                    let msg = match deserialize(&event.data) {
                                        Ok(msg) => msg,
                                        Err(e) => {
                                            eprintln!("Failed to deserialize {:?} {:?}", event, e);
                                            continue;
                                        }
                                    };
                                    
                                    // Check if this is an Init packet and extract connection ID and token
                                    if let ToClientBody::Init { i } = &msg.b {
                                        *connection.lock().await = SseConnectionInner::Opened(ConnectionDetails {
                                            id: i.ci.clone(),
                                            token: i.ct.clone()
                                    });
                                    }
        
                                    if let Err(e) = in_tx.send(Arc::new(msg)).await {
                                        eprintln!("Failed to send text message: {}", e);
                                        break;
                                    }
                                },
                                SSE::Connected(_) => {
                                    eprintln!("Connected Sse");
                                }
                            }
                            Err(e) => {
                                eprintln!("Sse error: {}", e);
                                break;
                            }
                        }
                    }
                }
            }
        });

    }


    fn build_conn_url(&self) -> String {
        format!("{}/connect/sse?encoding={}", self.endpoint, self.encoding_kind.as_str())
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

fn json_serialize(value: &ToServer) -> Result<Vec<u8>> {
    let msg = serde_json::to_vec(value)?;

    Ok(msg)
}

fn cbor_serialize(msg: &ToServer) -> Result<Vec<u8>> {
    let msg = serde_cbor::to_vec(msg).context("serde failure:")?;

    Ok(msg)
}