use anyhow::Result;
use serde_json::{json, Value};

use crate::drivers::TransportKind;
use crate::encoding::EncodingKind;
use crate::handle::{ActorHandle, ActorHandleInner};

pub struct Client {
    manager_endpoint: String,
    encoding_kind: EncodingKind,
    transport_kind: TransportKind,
}

impl Client {
    pub fn new(
        manager_endpoint: String,
        transport_kind: TransportKind,
        encoding_kind: EncodingKind,
    ) -> Self {
        Self {
            manager_endpoint,
            encoding_kind,
            transport_kind
        }
    }

    async fn post_manager_endpoint(&self, path: &str, body: Value) -> Result<Value> {
        let client = reqwest::Client::new();
        let req = client.post(
            format!("{}{}", self.manager_endpoint, path)
        );
        let req = req.header("Content-Type", "application/json");
        let req = req.body(
            serde_json::to_string(&body)?
        );
        let res = req.send().await?;
        let body = res.text().await?;
        
        let body: Value = serde_json::from_str(&body)?;

        Ok(body)
    }

    #[allow(dead_code)]
    async fn get_manager_endpoint(&self, path: &str) -> Result<Value> {
        let client = reqwest::Client::new();
        let req = client.get(
            format!("{}{}", self.manager_endpoint, path)
        );
        let res = req.send().await?;
        let body = res.text().await?;
        let body: Value = serde_json::from_str(&body)?;

        Ok(body)
    }

    pub async fn get(&self, tags: Vec<(String, String)>) -> Result<ActorHandle> {
        // TODO: opts
        // TODO: Make sure `name` tag is present
        let mut tag_map = serde_json::Map::new();
    
        for (key, value) in tags {
            tag_map.insert(key, Value::String(value));
        }

        let body = json!({
            "query": {
                "getOrCreateForTags": {
                    "tags": tag_map,
                    "create": {
                        "tags": tag_map
                    }
                }
            },
        });
        let res_json = self.post_manager_endpoint("/manager/actors", body).await?;
        let Some(endpoint) = res_json["endpoint"].as_str() else {
            return Err(anyhow::anyhow!("No endpoint returned. Request failed? {:?}", res_json));
        };

        let handle = ActorHandleInner::new(
            endpoint.to_string(),
            self.transport_kind,
            self.encoding_kind
        )?;
        handle.connect().await?;

        Ok(handle)
    }
}
