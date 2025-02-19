use tokio_tungstenite::{WebSocketStream, MaybeTlsStream};
use anyhow::Result;
use std::ops::Deref;
use std::sync::atomic::{AtomicI64, Ordering};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::{oneshot, Mutex};
use serde_json::{json, Value};

use crate::drivers::TransportKind;
use crate::encoding::EncodingKind;
use crate::protocol::*;

use super::drivers;
use super::protocol;

pub enum ConnectionTransport {
    WebSocket(WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>)
}

type RpcResponse = Result<RpcResponseOk, RpcResponseError>;
type EventCallback = dyn Fn(&Vec<Value>) + Send + Sync;

pub type ActorHandle = Arc<ActorHandleInner>;

pub struct ActorHandleInner {
    pub endpoint: String,
    transport_driver: drivers::sse::SseDriver,
    sender: Mutex<Option<drivers::sse::SseSender>>,
    // transport_driver: drivers::ws::WebSocketDriver,
    // sender: Mutex<Option<drivers::ws::WebSocketSender>>,
    rpc_counter: AtomicI64,
    /// Map between rpc id and resolution channel
    in_flight_rpcs: Mutex<HashMap<
        i64,
        oneshot::Sender<RpcResponse>
    >>,
    event_subscriptions: Mutex<HashMap<
        String, Vec<Box<EventCallback>>
    >>,
}

impl ActorHandleInner {
    pub(crate) fn new(
        endpoint: String,
        transport_kind: TransportKind,
        encoding_kind: EncodingKind,
    ) -> Result<ActorHandle> {
        println!("Transport kind {:?} being ignored", transport_kind);
        // let driver = drivers::ws::WebSocketDriver::new(
        //     endpoint.clone(),
        //     encoding_kind
        // )?;
        let driver = drivers::sse::SseDriver::new(
            endpoint.clone(),
            encoding_kind
        )?;
            
        Ok(Arc::new(Self {
            endpoint: endpoint.clone(),
            transport_driver: driver,
            sender: Mutex::new(None),
            rpc_counter: AtomicI64::new(0),
            in_flight_rpcs: Mutex::new(HashMap::new()),
            event_subscriptions: Mutex::new(HashMap::new()),
        }))
    }

    pub(crate) async fn connect(self: &Arc<Self>) -> Result<()> {
        let (sender, mut recver) = self.transport_driver.connect().await?;
        {
            let mut my_sender = self.sender.lock().await;
            *my_sender = Some(sender);
         }

        // spawn listener for rpcs
        let handle = self.clone();
        tokio::spawn(async move {
            loop {
                let Some(msg) = recver.recv_msg().await else {
                    // Socket closed
                    println!("Socket closed");
                    break;
                };

                let body = &msg.b;

                match body {
                    protocol::ToClientBody::ResponseOk { ro } => {
                        let id = ro.i;
                        let mut in_flight_rpcs = handle.in_flight_rpcs.lock().await;
                        let Some(tx) = in_flight_rpcs.remove(&id) else {
                            println!("Unexpected response: rpc id not found");
                            continue;
                        };
                        if let Err(e) = tx.send(Ok(ro.clone())) {
                            eprintln!("{:?}", e);
                            continue;
                        }
                    },
                    protocol::ToClientBody::ResponseError { re } => {
                        let id = re.i;
                        let mut in_flight_rpcs = handle.in_flight_rpcs.lock().await;
                        let Some(tx) = in_flight_rpcs.remove(&id) else {
                            println!("Unexpected response: rpc id not found");
                            continue;
                        };
                        if let Err(e) = tx.send(Err(re.clone())) {
                            eprintln!("{:?}", e);
                            continue;
                        }
                    },
                    protocol::ToClientBody::EventMessage { ev } => {
                        let listeners = handle.event_subscriptions.lock().await;
                        if let Some(callbacks) = listeners.get(&ev.n) {
                            for cb in callbacks {
                                cb(&ev.a);
                            }
                        }
                    },
                    protocol::ToClientBody::EventError { er } => {
                        eprintln!("Event error: {:?}", er);
                    },
                    _ => {}
                }
            }
        });


        Ok(())
    }

    pub async fn send_msg(self: &Arc<Self>, msg: protocol::ToServer) -> Result<()> {
        let sender = self.sender.lock().await;
        let Some(sender) = sender.deref() else {
            return Err(anyhow::anyhow!("Not connected"));
        };

        sender.send_raw(Arc::new(msg)).await?;
        Ok(())
    }

    pub async fn rpc(
        self: &Arc<Self>,
        method: &str,
        params: Vec<Value>
    ) -> Result<Value> {
        let id: i64 = self.rpc_counter
            .fetch_add(1, Ordering::SeqCst);

        let (tx, rx) = oneshot::channel();
        self.in_flight_rpcs.lock().await.insert(id, tx);

        self.send_msg(protocol::ToServer {
            b: protocol::ToServerBody::RpcRequest {
                rr: protocol::RpcRequest {
                    i: id,
                    n: method.to_string(),
                    a: params,
                }
            }
        }).await?;

        // TODO: Support reconnection
        let Ok(res) = rx.await else {
            // Verbosity
            return Err(anyhow::anyhow!("Socket closed during rpc"));
        };

        match res {
            Ok(ok) => Ok(ok.o),
            Err(err) => {
                let metadata = err.md.unwrap_or(json!(null));
                
                Err(anyhow::anyhow!(
                    "RPC Error({}): {:?}, {:#}", 
                    err.c, err.m, metadata
                ))
            }
        }
    }

    async fn send_subscription(
        self: &Arc<Self>,
        event_name: String,
        subscribe: bool
    ) -> Result<(), anyhow::Error> {
        self.send_msg(protocol::ToServer {
            b: protocol::ToServerBody::SubscriptionRequest {
                sr: protocol::SubscriptionRequest {
                    e: event_name,
                    s: subscribe
                }
            }
        }).await?;

        Ok(())
    }

    async fn add_event_subscription(
        self: &Arc<Self>,
        event_name: String,
        callback: Box<EventCallback>
    ) -> Result<(), anyhow::Error> {
        // TODO: Support for once
        let mut listeners = self.event_subscriptions.lock().await;
        
        if listeners.contains_key(&event_name) == false {
            self.send_subscription(event_name.clone(), true).await?;
        }

        listeners
            .entry(event_name)
            .or_insert(Vec::new())
            .push(callback);

        Ok(())
    }

    pub async fn on_event<F>(
        self: &Arc<Self>,
        event_name: &str,
        callback: F
    ) -> Result<(), anyhow::Error> 
    where
        F: Fn(&Vec<Value>) + Send + Sync + 'static
    {
        self.add_event_subscription(
            event_name.to_string(),
            Box::new(callback)
        ).await?;
        Ok(())
    }
}