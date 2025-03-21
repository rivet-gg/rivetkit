use anyhow::Result;
use serde_json::{json, Value};

use crate::drivers::TransportKind;
use crate::encoding::EncodingKind;
use crate::handle::{ActorHandle, ActorHandleInner};

type ActorTags = Vec<(String, String)>;

pub struct CreateRequestMetadata {
    pub tags: ActorTags,
    pub region: Option<String>,
}

pub struct PartialCreateRequestMetadata {
    pub tags: Option<ActorTags>,
    pub region: Option<String>,
}

pub struct GetWithIdOptions {
    pub params: Option<serde_json::Value>,
}

impl Default for GetWithIdOptions {
    fn default() -> Self {
        Self { params: None }
    }
}

pub struct GetOptions {
    pub tags: Option<ActorTags>,
    pub params: Option<serde_json::Value>,
    pub no_create: Option<bool>,
    pub create: Option<PartialCreateRequestMetadata>,
}

impl Default for GetOptions {
    fn default() -> Self {
        Self {
            tags: None,
            params: None,
            no_create: None,
            create: None,
        }
    }
}

pub struct CreateOptions {
    pub params: Option<serde_json::Value>,
    pub create: CreateRequestMetadata,
}

impl Default for CreateOptions {
    fn default() -> Self {
        Self {
            params: None,
            create: CreateRequestMetadata {
                tags: vec![],
                region: None,
            },
        }
    }
}

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
            transport_kind,
        }
    }

    async fn post_manager_endpoint(&self, path: &str, body: Value) -> Result<Value> {
        let client = reqwest::Client::new();
        let req = client.post(format!("{}{}", self.manager_endpoint, path));
        let req = req.header("Content-Type", "application/json");
        let req = req.body(serde_json::to_string(&body)?);
        let res = req.send().await?;
        let body = res.text().await?;

        let body: Value = serde_json::from_str(&body)?;

        Ok(body)
    }

    #[allow(dead_code)]
    async fn get_manager_endpoint(&self, path: &str) -> Result<Value> {
        let client = reqwest::Client::new();
        let req = client.get(format!("{}{}", self.manager_endpoint, path));
        let res = req.send().await?;
        let body = res.text().await?;
        let body: Value = serde_json::from_str(&body)?;

        Ok(body)
    }

    pub async fn get(&self, name: &str, opts: GetOptions) -> Result<ActorHandle> {
        // Convert tags to a map for JSON
        let tags_map: serde_json::Map<String, Value> = opts.tags
            .unwrap_or_default()
            .into_iter()
            .map(|(k, v)| (k, json!(v)))
            .collect();
            
        // Build create object if no_create is false
        let create = if !opts.no_create.unwrap_or(false) {
            // Start with create options if provided
            if let Some(create_opts) = &opts.create {
                // Build tags map - use create.tags if provided, otherwise fall back to query tags
                let create_tags = if let Some(tags) = &create_opts.tags {
                    tags.iter()
                        .map(|(k, v)| (k.clone(), json!(v.clone())))
                        .collect()
                } else {
                    tags_map.clone()
                };
                
                // Build create object with name, tags, and optional region
                let mut create_obj = json!({
                    "name": name,
                    "tags": create_tags
                });
                
                if let Some(region) = &create_opts.region {
                    create_obj["region"] = json!(region.clone());
                }
                
                Some(create_obj)
            } else {
                // Create with just the name and query tags
                Some(json!({
                    "name": name,
                    "tags": tags_map
                }))
            }
        } else {
            None
        };
        
        // Build the request body
        let body = json!({
            "query": {
                "getOrCreateForTags": {
                    "name": name,
                    "tags": tags_map,
                    "create": create
                }
            }
        });
        let res_json = self.post_manager_endpoint("/manager/actors", body).await?;
        let Some(endpoint) = res_json["endpoint"].as_str() else {
            return Err(anyhow::anyhow!(
                "No endpoint returned. Request failed? {:?}",
                res_json
            ));
        };

        let handle = ActorHandleInner::new(
            endpoint.to_string(),
            self.transport_kind,
            self.encoding_kind,
            opts.params,
        )?;
        handle.start_connection().await;

        Ok(handle)
    }

    pub async fn get_with_id(&self, actor_id: &str, opts: GetWithIdOptions) -> Result<ActorHandle> {
        let body = json!({
            "query": {
                "getForId": {
                    "actorId": actor_id,
                }
            },
        });
        let res_json = self.post_manager_endpoint("/manager/actors", body).await?;
        let Some(endpoint) = res_json["endpoint"].as_str() else {
            return Err(anyhow::anyhow!(
                "No endpoint returned. Request failed? {:?}",
                res_json
            ));
        };

        let handle = ActorHandleInner::new(
            endpoint.to_string(),
            self.transport_kind,
            self.encoding_kind,
            opts.params,
        )?;
        handle.start_connection().await;

        Ok(handle)
    }

    pub async fn create(&self, name: &str, opts: CreateOptions) -> Result<ActorHandle> {
        let mut tag_map = serde_json::Map::new();

        for (key, value) in opts.create.tags {
            tag_map.insert(key, json!(value));
        }

        let mut req_body = serde_json::Map::new();
        req_body.insert("name".to_string(), json!(name.to_string()));
        req_body.insert("tags".to_string(), json!(tag_map));
        if let Some(region) = opts.create.region {
            req_body.insert("region".to_string(), json!(region));
        }

        let body = json!({
            "query": {
                "create": req_body
            },
        });
        let res_json = self.post_manager_endpoint("/manager/actors", body).await?;
        let Some(endpoint) = res_json["endpoint"].as_str() else {
            return Err(anyhow::anyhow!(
                "No endpoint returned. Request failed? {:?}",
                res_json
            ));
        };

        let handle = ActorHandleInner::new(
            endpoint.to_string(),
            self.transport_kind,
            self.encoding_kind,
            opts.params,
        )?;
        handle.start_connection().await;

        Ok(handle)
    }
}
