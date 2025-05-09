use std::sync::Arc;
use actor_core_client::{self as actor_core_rs};
use futures_util::FutureExt;
use pyo3::{prelude::*, types::{PyList, PyString, PyTuple}};
use tokio::sync::{mpsc, Mutex};

use crate::util;

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
        Err(py_runtime_err!(
            "Actor handle cannot be instantiated directly",
        ))
    }

    pub fn action<'a>(
        &self,
        py: Python<'a>, 
        method: &str,
        args: Vec<PyObject>
    ) -> PyResult<Bound<'a, PyAny>> {
        let method = method.to_string();
        let handle = self.handle.clone();
        
        pyo3_async_runtimes::tokio::future_into_py(py, async move {
            let args = Python::with_gil(|py| util::py_to_json_value(py, &args))?;
            let result = handle.action(&method, args).await;
            let Ok(result) = result else {
                return Err(py_runtime_err!(
                    "Failed to call action: {:?}",
                    result.err()
                ));
            };
            let mut result = Python::with_gil(|py| {
                match util::json_to_py_value(py, &vec![result]) {
                    Ok(value) => Ok(
                        value.iter()
                            .map(|x| x.clone().unbind())
                            .collect::<Vec<PyObject>>()
                    ),
                    Err(e) => Err(e),
                }
            })?;
            let Some(result) = result.drain(0..1).next() else {
                return Err(py_runtime_err!(
                    "Expected one result, got {}",
                    result.len()
                ));
            };

            Ok(result)
        })
    }

    pub fn subscribe<'a>(
        &self,
        py: Python<'a>, 
        event_name: &str
    ) -> PyResult<Bound<'a, PyAny>> {
        let event_name = event_name.to_string();
        let data = self.data.clone();
        let handle = self.handle.clone();

        pyo3_async_runtimes::tokio::future_into_py(py, async move {
            handle.on_event(&event_name.clone(), move |args| {
                let event_name = event_name.clone();
                let args = args.clone();
                let data = data.clone();
                
                tokio::spawn(async move {
                    data.on_event(event_name, &args).await;
                });
            }).await;

            Ok(())
        })
    }

    #[pyo3(signature=(count, timeout=None))]
    pub fn receive<'a>(
        &self,
        py: Python<'a>,
        count: u32,
        timeout: Option<f64>
    ) -> PyResult<Bound<'a, PyAny>>  {
        let (tx, mut rx) = mpsc::channel(count as usize);

        let data = self.data.clone();
        pyo3_async_runtimes::tokio::future_into_py(py, async move {
            data.event_tx.lock().await.replace(tx);

            let result: Vec<ActorEvent> = {
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
                            Python::with_gil(|py| py.check_signals())?;
                        }
                    };
                }

                Ok::<_, PyErr>(events)
            }?;

            // Convert events to Python objects
            Python::with_gil(|py| {
                let py_events = PyList::empty(py);
                for event in result {
                    let event = PyTuple::new(py, &[
                        PyString::new(py, &event.name).as_any(),
                        PyList::new(py, &util::json_to_py_value(py, &event.args)?)?.as_any(),
                    ])?;
                    py_events.append(event)?;
                }
                
                Ok(py_events.unbind())
            })
        })
    }

    pub fn disconnect<'a>(&self, py: Python<'a>) -> PyResult<Bound<'a, PyAny>> {
        let handle = self.handle.clone();

        pyo3_async_runtimes::tokio::future_into_py(py, async move {
            handle.disconnect().await;

            Ok(())
        })
    }
}