use std::sync::Arc;
use actor_core_client::{self as actor_core_rs};
use futures_util::FutureExt;
use pyo3::{prelude::*, types::{PyList, PyString, PyTuple}};
use tokio::sync::{mpsc, Mutex};

use crate::util::{self, SYNC_RUNTIME};

struct ActorEvent {
    name: String,
    args: Vec<serde_json::Value>,
}

pub struct InnerActorData {
    event_tx: Mutex<Option<mpsc::Sender<ActorEvent>>>,
}

impl InnerActorData {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            event_tx: Mutex::new(None),
        })
    }
}

impl InnerActorData {
    pub async fn on_event(
        &self,
        event_name: String,
        args: &Vec<serde_json::Value>
    ) {
        let tx = &self.event_tx.lock().await;
        let Some(tx) = tx.as_ref() else {
            return;
        };

        tx.send(ActorEvent {
            name: event_name,
            args: args.clone(),
        }).await.map_err(|e| {
            py_runtime_err!(
                "Failed to send via inner tx: {}",
                e
            )
        }).ok();
    }
}

#[pyclass]
pub struct ActorHandle {
    pub handle: actor_core_rs::handle::ActorHandle,
    pub data: Arc<InnerActorData>,
}

#[pymethods]
impl ActorHandle {
    #[new]
    pub fn new() -> PyResult<Self> {
        Err(py_runtime_err!("Actor handle cannot be instantiated directly"))
    }

    #[pyo3(signature=(method, *py_args))]
    pub fn action<'a>(
        &self,
        py: Python<'a>, 
        method: &str,
        py_args: &Bound<'_, PyTuple>,
    ) -> PyResult<Bound<'a, PyAny>> {
        let args = py_args.extract::<Vec<PyObject>>()?;

        let result = self.handle.action(
            method,
            util::py_to_json_value(py, &args)?
        );
        let result = SYNC_RUNTIME.block_on(result);

        let Ok(result) = result else {
            return Err(py_runtime_err!(
                "Failed to call action: {:?}",
                result.err()
            ));
        };
        
        let mut result = util::json_to_py_value(py, &vec![result])?;
        let Some(result) = result.drain(0..1).next() else {
            return Err(py_runtime_err!(
                "Expected one result, got {}",
                result.len()
            ));
        };

        Ok(result)
    }

    pub fn subscribe(
        &self,
        event_name: &str,
    ) -> PyResult<()> {
        let event_name = event_name.to_string();
        let data = self.data.clone();
        
        SYNC_RUNTIME.block_on(
            self.handle.on_event(&event_name.clone(), move |args| {
                let event_name = event_name.clone();
                let args = args.clone();
                let data = data.clone();
                
                tokio::spawn(async move {
                    data.on_event(event_name, &args).await;
                });
            })
        );

        Ok(())
    }
    
    #[pyo3(signature=(count, timeout=None))]
    pub fn receive<'a>(
        &self,
        py: Python<'a>,
        count: u32,
        timeout: Option<f64>
    ) -> PyResult<Bound<'a, PyList>> {
        let (tx, mut rx) = mpsc::channel(count as usize);

        SYNC_RUNTIME.block_on(async {
            self.data.event_tx.lock().await.replace(tx);
        });

        let result: Vec<ActorEvent> = SYNC_RUNTIME.block_on(async {
            let mut events: Vec<ActorEvent> = Vec::new();
            
            loop {
                if events.len() >= count as usize {
                    break;
                }

                let timeout_rx_future = match timeout {
                    Some(timeout) => {
                        let timeout = std::time::Duration::from_secs_f64(timeout);
                        tokio::time::timeout(timeout, rx.recv())
                            .map(|x| x.unwrap_or(None)).boxed()
                    },
                    None => rx.recv().boxed()
                };

                tokio::select! {
                    result = timeout_rx_future => {
                        match result {
                            Some(event) => events.push(event),
                            None => break,
                        }
                    },
                    // TODO: Add more signal support
                    _ = tokio::signal::ctrl_c() => {
                        py.check_signals()?;
                    }
                };
            }

            Ok::<_, PyErr>(events)
        })?;

        // Convert events to Python objects
        let py_events = PyList::empty(py);
        for event in result {
            let event = PyTuple::new(py, &[
                PyString::new(py, &event.name).as_any(),
                PyList::new(py, &util::json_to_py_value(py, &event.args)?)?.as_any(),
            ])?;
            py_events.append(event)?;
        }
        
        Ok(py_events)
    }

    pub fn disconnect(&self) {
        SYNC_RUNTIME.block_on(
            self.handle.disconnect()
        )
    }
}