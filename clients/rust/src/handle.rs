use std::{cell::RefCell, ops::Deref, sync::Arc};
use serde_json::Value as JsonValue;
use anyhow::{anyhow, Result};
use urlencoding::encode as url_encode;
use crate::{
    common::{resolve_actor_id, send_http_request, HttpRequestOptions, HEADER_ACTOR_QUERY, HEADER_CONN_PARAMS, HEADER_ENCODING},
    connection::{start_connection, ActorConnection, ActorConnectionInner},
    protocol::query::*,
    EncodingKind,
    TransportKind
};

pub struct ActorHandleStateless {
    endpoint: String,
    params: Option<JsonValue>,
    encoding_kind: EncodingKind,
    query: RefCell<ActorQuery>,
}

impl ActorHandleStateless {
    pub fn new(
        endpoint: &str,
        params: Option<JsonValue>,
        encoding_kind: EncodingKind,
        query: ActorQuery
    ) -> Self {
        Self {
            endpoint: endpoint.to_string(),
            params,
            encoding_kind,
            query: RefCell::new(query)
        }
    }

    pub async fn action(&self, name: &str, args: Vec<JsonValue>) -> Result<JsonValue> {
        #[derive(serde::Serialize)]
        struct ActionRequest {
            a: Vec<JsonValue>,
        }
        #[derive(serde::Deserialize)]
        struct ActionResponse {
            o: JsonValue,
        }

        let actor_query = serde_json::to_string(&self.query)?;

        // Build headers
        let mut headers = vec![
            (HEADER_ENCODING, self.encoding_kind.to_string()),
            (HEADER_ACTOR_QUERY, actor_query),
        ];

        if let Some(params) = &self.params {
            headers.push((HEADER_CONN_PARAMS, serde_json::to_string(params)?));
        }

        let res = send_http_request::<ActionRequest, ActionResponse>(HttpRequestOptions {
            url: &format!(
                "{}/actors/actions/{}",
                self.endpoint,
                url_encode(name)
            ),
            method: "POST",
            headers,
            body: Some(ActionRequest {
                a: args,
            }),
            encoding_kind: self.encoding_kind,
        }).await?;

        Ok(res.o)
    }

    pub async fn resolve(&self) -> Result<String> {
        let query = {
            // None of this is async or runs on multithreads,
            // it cannot fail given that both borrows are
            // well contained, and cannot overlap.
            let Ok(query) = self.query.try_borrow() else {
                return Err(anyhow!("Failed to borrow actor query"));
            };

            query.clone()
        };

        match query {
            ActorQuery::Create { create: _query } => {
                Err(anyhow!("actor query cannot be create"))
            },
            ActorQuery::GetForId { get_for_id: query } => {
                Ok(query.clone().actor_id)
            },
            _ => {
                let actor_id = resolve_actor_id(
                    &self.endpoint,
                    query,
                    self.encoding_kind
                ).await?;

                {
                    let Ok(mut query) = self.query.try_borrow_mut() else {
                        // Following code will not run (see prior note)
                        return Err(anyhow!("Failed to borrow actor query mutably"));
                    };

                    *query = ActorQuery::GetForId {
                        get_for_id: GetForIdRequest {
                            actor_id: actor_id.clone(),
                        }
                    };
                }

                Ok(actor_id)
            }
        }
    }
}

pub struct ActorHandle {
    handle: ActorHandleStateless,
    endpoint: String,
    params: Option<JsonValue>,
    query: ActorQuery,
    client_shutdown_tx: Arc<tokio::sync::broadcast::Sender<()>>,
    transport_kind: crate::TransportKind,
    encoding_kind: EncodingKind,
}

impl ActorHandle {
    pub fn new(
        endpoint: &str,
        params: Option<JsonValue>,
        query: ActorQuery,
        client_shutdown_tx: Arc<tokio::sync::broadcast::Sender<()>>,
        transport_kind: TransportKind,
        encoding_kind: EncodingKind
    ) -> Self {
        let handle = ActorHandleStateless::new(
            endpoint,
            params.clone(),
            encoding_kind,
            query.clone()
        );

        Self {
            handle,
            endpoint: endpoint.to_string(),
            params,
            query,
            client_shutdown_tx,
            transport_kind,
            encoding_kind,
        }
    }

    pub fn connect(&self) -> ActorConnection {
        let conn = ActorConnectionInner::new(
            self.endpoint.clone(),
            self.query.clone(),
            self.transport_kind,
            self.encoding_kind,
            self.params.clone()
        );

        let rx = self.client_shutdown_tx.subscribe();
        start_connection(&conn, rx);

        conn
    }
}

impl Deref for ActorHandle {
    type Target = ActorHandleStateless;

    fn deref(&self) -> &Self::Target {
        &self.handle
    }
}