use std::sync::Arc;

use anyhow::Result;
use serde_json::{Value as JsonValue};

use crate::{
    common::{resolve_actor_id, ActorKey, EncodingKind, TransportKind},
    handle::ActorHandle,
    protocol::query::*
};

#[derive(Default)]
pub struct GetWithIdOptions {
    pub params: Option<JsonValue>,
}

#[derive(Default)]
pub struct GetOptions {
    pub params: Option<JsonValue>,
}

#[derive(Default)]
pub struct GetOrCreateOptions {
    pub params: Option<JsonValue>,
    pub create_in_region: Option<String>,
    pub create_with_input: Option<JsonValue>,
}

#[derive(Default)]
pub struct CreateOptions {
    pub params: Option<JsonValue>,
    pub region: Option<String>,
    pub input: Option<JsonValue>,
}


pub struct Client {
    manager_endpoint: String,
    encoding_kind: EncodingKind,
    transport_kind: TransportKind,
    shutdown_tx: Arc<tokio::sync::broadcast::Sender<()>>,
}

impl Client {
    pub fn new(
        manager_endpoint: &str,
        transport_kind: TransportKind,
        encoding_kind: EncodingKind,
    ) -> Self {
        Self {
            manager_endpoint: manager_endpoint.to_string(),
            encoding_kind,
            transport_kind,
            shutdown_tx: Arc::new(tokio::sync::broadcast::channel(1).0)
        }
    }

    fn create_handle(
        &self,
        params: Option<JsonValue>,
        query: ActorQuery
    ) -> ActorHandle {
        let handle = ActorHandle::new(
            &self.manager_endpoint,
            params,
            query,
            self.shutdown_tx.clone(),
            self.transport_kind,
            self.encoding_kind
        );

        handle
    }

    pub fn get(
        &self,
        name: &str,
        key: ActorKey,
        opts: GetOptions
    ) -> Result<ActorHandle> {
        let actor_query = ActorQuery::GetForKey {
            get_for_key: GetForKeyRequest {
                name: name.to_string(),
                key,
            }
        };

        let handle = self.create_handle(
            opts.params,
            actor_query
        );

        Ok(handle)
    }

    pub fn get_for_id(
        &self,
        actor_id: &str,
        opts: GetOptions
    ) -> Result<ActorHandle> {
        let actor_query = ActorQuery::GetForId {
            get_for_id: GetForIdRequest {
                actor_id: actor_id.to_string(),
            }
        };

        let handle = self.create_handle(
            opts.params,
            actor_query
        );

        Ok(handle)
    }

    pub fn get_or_create(
        &self,
        name: &str,
        key: ActorKey,
        opts: GetOrCreateOptions
    ) -> Result<ActorHandle> {
        let input = opts.create_with_input;
        let region = opts.create_in_region;

        let actor_query = ActorQuery::GetOrCreateForKey {
            get_or_create_for_key: GetOrCreateRequest {
                name: name.to_string(),
                key: key,
                input,
                region
            }
        };

        let handle = self.create_handle(
            opts.params,
            actor_query,
        );

        Ok(handle)
    }

    pub async fn create(
        &self,
        name: &str,
        key: ActorKey,
        opts: CreateOptions
    ) -> Result<ActorHandle> {
        let input = opts.input;
        let region = opts.region;

        let create_query = ActorQuery::Create {
            create: CreateRequest {
                name: name.to_string(),
                key,
                input,
                region
            }
        };

        let actor_id = resolve_actor_id(
            &self.manager_endpoint,
            create_query,
            self.encoding_kind
        ).await?;

        let get_query = ActorQuery::GetForId {
            get_for_id: GetForIdRequest {
                actor_id,
            }
        };

        let handle = self.create_handle(
            opts.params,
            get_query
        );

        Ok(handle)
    }

    pub fn disconnect(self) {
        drop(self)
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        // Notify all subscribers to shutdown
        let _ = self.shutdown_tx.send(());
    }
}