use std::sync::Arc;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use anyhow::{Result, Context};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use url::Url;

use crate::encoding::EncodingKind;
use crate::protocol::{ToClient, ToServer};


pub struct WebSocketSender {
    pub tx: mpsc::Sender<Arc<ToServer>>,
}

// TODO: Maybe turn this into a Sink
impl WebSocketSender {
    pub async fn send_raw(&self, msg: Arc<ToServer>) -> Result<()> {
        self.tx.send(msg)
            .await
            .context("Failed to send message")?;

        Ok(())
    }
}

pub struct WebSocketReceiver {
    pub rx: mpsc::Receiver<Arc<ToClient>>,
}

// TODO: Maybe turn this into a StreamExt
impl WebSocketReceiver {  
    pub async fn recv_msg(&mut self) -> Option<Arc<ToClient>> {
        self.rx.recv().await
    }
}

pub struct WebSocketDriver {
    endpoint: String,
    encoding_kind: EncodingKind
}

impl WebSocketDriver {
    pub fn new(endpoint: String, encoding_kind: EncodingKind) -> Result<Self> {
        Ok(WebSocketDriver {
            endpoint: replace_http_with_ws(&endpoint)?,
            encoding_kind
        })
    }

    pub async fn connect(
        &self
    ) -> Result<(WebSocketSender, WebSocketReceiver)> {
        let (in_tx, in_rx) = mpsc::channel::<Arc<ToClient>>(32);
        let (out_tx, out_rx) = mpsc::channel::<Arc<ToServer>>(32);

        let url = self.build_conn_url();
        println!("ws url: {}", url);
        let (ws, _res) = tokio_tungstenite::connect_async(url)
            .await
            .context("Failed to connect to WebSocket")?;
        
        tokio::spawn(WebSocketDriver::start(ws, self.encoding_kind, in_tx, out_rx));

        Ok((WebSocketSender { tx: out_tx }, WebSocketReceiver { rx: in_rx }))
    }
        
    async fn start(
        ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
        encoding_kind: EncodingKind,
        in_tx: mpsc::Sender<Arc<ToClient>>,
        mut out_rx: mpsc::Receiver<Arc<ToServer>>
    ) {
        let (mut ws_sink, mut ws_stream) = ws.split(); 

        let serialize = match encoding_kind {
            EncodingKind::Json => json_msg_serialize,
            EncodingKind::Cbor => cbor_msg_serialize
        };
        let deserialize = match encoding_kind {
            EncodingKind::Json => json_msg_deserialize,
            EncodingKind::Cbor => cbor_msg_deserialize
        };

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    // Dispatch ws outgoing queue
                    msg = out_rx.recv() => {
                        // If the sender is dropped, break the loop
                        let Some(msg) = msg else {
                            println!("Sender dropped");
                            break;
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
                            break;
                        }
                    },
                    // Handle ws incoming
                    msg = ws_stream.next() => {
                        let Some(msg) = msg else {
                            println!("Receiver dropped");
                            break;
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
                                        break;
                                    }
                                },
                                Message::Close(_) => {
                                    eprintln!("Close message");
                                    break;
                                },
                                _ => {
                                    eprintln!("Invalid message type");
                                }
                            }
                            Err(e) => {
                                eprintln!("WebSocket error: {}", e);
                                break;
                            }
                        }
                    }
                }
            }
        });
    }

    fn build_conn_url(&self) -> String {
        format!("{}/connect/websocket?encoding={}", self.endpoint, self.encoding_kind.as_str())
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


fn replace_http_with_ws(url_str: &str) -> Result<String, anyhow::Error> {
    let mut url = Url::parse(url_str)?;
    if url.scheme() == "http" {
        if url.set_scheme("ws").is_err() {
            return Err(anyhow::anyhow!("Failed to set scheme to ws"));
        }
    } else if url.scheme() == "https" {
        if url.set_scheme("wss").is_err() {
            return Err(anyhow::anyhow!("Failed to set scheme to wss"));
        }
    } else {
        return Err(anyhow::anyhow!("Invalid scheme: {:?}", url.scheme()));
    }
    Ok(url.to_string())
}