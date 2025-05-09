use anyhow::Result;
use futures_util::FutureExt;
use serde_json::Value;
use std::fmt::Debug;
use std::ops::Deref;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::{oneshot, watch, Mutex};

use crate::drivers::{DriverHandle, DriverStopReason, TransportKind};
use crate::encoding::EncodingKind;
use crate::{backoff::Backoff, protocol::*};
use tracing::debug;

use super::protocol;

type RpcResponse = Result<RpcResponseOk, RpcResponseError>;
type EventCallback = dyn Fn(&Vec<Value>) + Send + Sync;

struct SendMsgOpts {
    ephemeral: bool,
}

impl Default for SendMsgOpts {
    fn default() -> Self {
        Self { ephemeral: false }
    }
}

// struct WatchPair {
//     tx: watch::Sender<bool>,
//     rx: watch::Receiver<bool>,
// }
type WatchPair = (watch::Sender<bool>, watch::Receiver<bool>);

pub type ActorHandle = Arc<ActorHandleInner>;

struct ConnectionAttempt {
    did_open: bool,
    _task_end_reason: DriverStopReason,
}

pub struct ActorHandleInner {
    pub endpoint: String,
    transport_kind: TransportKind,
    encoding_kind: EncodingKind,
    parameters: Option<Value>,

    driver: Mutex<Option<DriverHandle>>,
    msg_queue: Mutex<Vec<Arc<protocol::ToServer>>>,

    rpc_counter: AtomicI64,
    in_flight_rpcs: Mutex<HashMap<i64, oneshot::Sender<RpcResponse>>>,

    event_subscriptions: Mutex<HashMap<String, Vec<Box<EventCallback>>>>,

    dc_watch: WatchPair,
    disconnection_rx: Mutex<Option<oneshot::Receiver<()>>>,
}

impl ActorHandleInner {
    pub(crate) fn new(
        endpoint: String,
        transport_kind: TransportKind,
        encoding_kind: EncodingKind,
        parameters: Option<Value>,
    ) -> Result<ActorHandle> {
        Ok(Arc::new(Self {
            endpoint: endpoint.clone(),
            transport_kind,
            encoding_kind,
            parameters,
            driver: Mutex::new(None),
            msg_queue: Mutex::new(Vec::new()),
            rpc_counter: AtomicI64::new(0),
            in_flight_rpcs: Mutex::new(HashMap::new()),
            event_subscriptions: Mutex::new(HashMap::new()),
            dc_watch: watch::channel(false),
            disconnection_rx: Mutex::new(None),
        }))
    }

    fn is_disconnecting(self: &Arc<Self>) -> bool {
        *self.dc_watch.1.borrow() == true
    }

    async fn try_connect(self: &Arc<Self>) -> ConnectionAttempt {
        let (driver, mut recver, task) = match self
            .transport_kind
            .connect(self.endpoint.clone(), self.encoding_kind, &self.parameters)
            .await
        {
            Ok(a) => a,
            Err(_) => {
                // Either from immediate disconnect (local device connection refused)
                // or from error like invalid URL
                return ConnectionAttempt {
                    did_open: false,
                    _task_end_reason: DriverStopReason::TaskError,
                };
            }
        };

        {
            let mut my_driver = self.driver.lock().await;
            *my_driver = Some(driver);
        }

        let mut task_end_reason = task.map(|res| match res {
            Ok(a) => a,
            Err(task_err) => {
                if task_err.is_cancelled() {
                    DriverStopReason::UserAborted
                } else {
                    DriverStopReason::TaskError
                }
            }
        });

        let mut did_connection_open = false;

        // spawn listener for rpcs
        let task_end_reason = loop {
            tokio::select! {
                reason = &mut task_end_reason => {
                    debug!("Connection closed: {:?}", reason);

                    break reason;
                },
                msg = recver.recv() => {
                    // If the sender is dropped, break the loop
                    let Some(msg) = msg else {
                        // break DriverStopReason::ServerDisconnect;
                        continue;
                    };

                    if let ToClientBody::Init { i: _ } = &msg.b {
                        did_connection_open = true;
                    }

                    self.on_message(msg).await;
                }
            }
        };

        'destroy_driver: {
            let mut d_guard = self.driver.lock().await;
            let Some(d) = d_guard.take() else {
                // We destroyed the driver already,
                // e.g. .disconnect() was called
                break 'destroy_driver;
            };

            d.disconnect();
        }

        ConnectionAttempt {
            did_open: did_connection_open,
            _task_end_reason: task_end_reason,
        }
    }

    pub(crate) async fn start_connection(self: &Arc<Self>) {
        let (tx, rx) = oneshot::channel();

        {
            let mut stop_rx = self.disconnection_rx.lock().await;
            if stop_rx.is_some() {
                // Already doing connection_with_retry
                // - this drops the oneshot
                return;
            }

            *stop_rx = Some(rx);
        }

        let handle = self.clone();

        tokio::spawn(async move {
            'keepalive: loop {
                debug!("Attempting to reconnect");
                let mut backoff = Backoff::new(Duration::from_secs(1), Duration::from_secs(30));
                let mut retry_attempt = 0;
                'retry: loop {
                    retry_attempt += 1;
                    debug!(
                        "Establish conn: attempt={}, timeout={:?}",
                        retry_attempt,
                        backoff.delay()
                    );
                    let attempt = handle.try_connect().await;

                    if handle.is_disconnecting() {
                        break 'keepalive;
                    }

                    if attempt.did_open {
                        break 'retry;
                    }

                    let mut dc_rx = handle.dc_watch.0.subscribe();

                    tokio::select! {
                        _ = backoff.tick() => {},
                        _ = dc_rx.wait_for(|x| *x == true) => {
                            break 'keepalive;
                        }
                    }
                }
            }

            tx.send(()).ok();
            handle.disconnection_rx.lock().await.take();
        });
    }

    async fn on_open(self: &Arc<Self>, init: &protocol::Init) {
        debug!("Connected to server: {:?}", init);

        for (event_name, _) in self.event_subscriptions.lock().await.iter() {
            self.send_subscription(event_name.clone(), true).await;
        }

        // Flush message queue
        for msg in self.msg_queue.lock().await.drain(..) {
            // If its in the queue, it isn't ephemeral, so we pass
            // default SendMsgOpts
            self.send_msg(msg, SendMsgOpts::default()).await;
        }
    }

    async fn on_message(self: &Arc<Self>, msg: Arc<protocol::ToClient>) {
        let body = &msg.b;

        match body {
            protocol::ToClientBody::Init { i: init } => {
                self.on_open(init).await;
            }
            protocol::ToClientBody::ResponseOk { ro } => {
                let id = ro.i;
                let mut in_flight_rpcs = self.in_flight_rpcs.lock().await;
                let Some(tx) = in_flight_rpcs.remove(&id) else {
                    debug!("Unexpected response: rpc id not found");
                    return;
                };
                if let Err(e) = tx.send(Ok(ro.clone())) {
                    debug!("{:?}", e);
                    return;
                }
            }
            protocol::ToClientBody::ResponseError { re } => {
                let id = re.i;
                let mut in_flight_rpcs = self.in_flight_rpcs.lock().await;
                let Some(tx) = in_flight_rpcs.remove(&id) else {
                    debug!("Unexpected response: rpc id not found");
                    return;
                };
                if let Err(e) = tx.send(Err(re.clone())) {
                    debug!("{:?}", e);
                    return;
                }
            }
            protocol::ToClientBody::EventMessage { ev } => {
                let listeners = self.event_subscriptions.lock().await;
                if let Some(callbacks) = listeners.get(&ev.n) {
                    for cb in callbacks {
                        cb(&ev.a);
                    }
                }
            }
            protocol::ToClientBody::EventError { er } => {
                debug!("Event error: {:?}", er);
            }
        }
    }

    async fn send_msg(self: &Arc<Self>, msg: Arc<protocol::ToServer>, opts: SendMsgOpts) {
        let guard = self.driver.lock().await;

        'send_immediately: {
            let Some(driver) = guard.deref() else {
                break 'send_immediately;
            };

            let Ok(_) = driver.send(msg.clone()).await else {
                break 'send_immediately;
            };

            return;
        }

        // Otherwise queue
        if opts.ephemeral == false {
            self.msg_queue.lock().await.push(msg.clone());
        }

        return;
    }

    pub async fn action(self: &Arc<Self>, method: &str, params: Vec<Value>) -> Result<Value> {
        let id: i64 = self.rpc_counter.fetch_add(1, Ordering::SeqCst);

        let (tx, rx) = oneshot::channel();
        self.in_flight_rpcs.lock().await.insert(id, tx);

        self.send_msg(
            Arc::new(protocol::ToServer {
                b: protocol::ToServerBody::RpcRequest {
                    rr: protocol::RpcRequest {
                        i: id,
                        n: method.to_string(),
                        a: params,
                    },
                },
            }),
            SendMsgOpts::default(),
        )
        .await;

        // TODO: Support reconnection
        let Ok(res) = rx.await else {
            // Verbosity
            return Err(anyhow::anyhow!("Socket closed during rpc"));
        };

        match res {
            Ok(ok) => Ok(ok.o),
            Err(err) => {
                let metadata = err.md.unwrap_or(Value::Null);

                Err(anyhow::anyhow!(
                    "RPC Error({}): {:?}, {:#}",
                    err.c,
                    err.m,
                    metadata
                ))
            }
        }
    }

    async fn send_subscription(self: &Arc<Self>, event_name: String, subscribe: bool) {
        self.send_msg(
            Arc::new(protocol::ToServer {
                b: protocol::ToServerBody::SubscriptionRequest {
                    sr: protocol::SubscriptionRequest {
                        e: event_name,
                        s: subscribe,
                    },
                },
            }),
            SendMsgOpts { ephemeral: true },
        )
        .await;
    }

    async fn add_event_subscription(
        self: &Arc<Self>,
        event_name: String,
        callback: Box<EventCallback>,
    ) {
        // TODO: Support for once
        let mut listeners = self.event_subscriptions.lock().await;

        let is_new_subscription = listeners.contains_key(&event_name) == false;

        listeners
            .entry(event_name.clone())
            .or_insert(Vec::new())
            .push(callback);

        if is_new_subscription {
            self.send_subscription(event_name, true).await;
        }
    }

    pub async fn on_event<F>(self: &Arc<Self>, event_name: &str, callback: F)
    where
        F: Fn(&Vec<Value>) + Send + Sync + 'static,
    {
        self.add_event_subscription(event_name.to_string(), Box::new(callback))
            .await
    }

    pub async fn disconnect(self: &Arc<Self>) {
        if self.is_disconnecting() {
            // We are already disconnecting
            return;
        }

        self.dc_watch.0.send(true).ok();

        if let Some(d) = self.driver.lock().await.deref() {
            d.disconnect()
        }
        self.in_flight_rpcs.lock().await.clear();
        self.event_subscriptions.lock().await.clear();
        let Some(rx) = self.disconnection_rx.lock().await.take() else {
            return;
        };

        rx.await.ok();
    }
}

impl Debug for ActorHandleInner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ActorHandle")
            .field("endpoint", &self.endpoint)
            .field("transport_kind", &self.transport_kind)
            .field("encoding_kind", &self.encoding_kind)
            .finish()
    }
}