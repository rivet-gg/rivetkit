use anyhow::Result;
use serde_json::{json, Value};

use crate::drivers::TransportKind;
use crate::encoding::EncodingKind;
use crate::handle::{ActorHandle, ActorHandleInner};

type ActorTags = Vec::<(String, String)>;

pub struct CreateRequestMetadata {
	pub tags: ActorTags,
	pub region: Option<String>
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
        Self {
            params: None,
        }
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
            }
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

    pub async fn get(
        &self,
        name: &str,
        opts: GetOptions
    ) -> Result<ActorHandle> {
        // TODO: opts
        // TODO: Make sure `name` tag is present
        let mut tag_map = serde_json::Map::new();
    
        for (key, value) in opts.tags.unwrap_or(vec![]) {
            tag_map.insert(key, Value::String(value));
        }

        // TODO: Struct or something, this is messy trying to skip Option::None
        let mut req_body = serde_json::Map::new();
        req_body.insert("name".to_string(), Value::String(name.to_string()));
        req_body.insert("tags".to_string(), Value::Object(tag_map));
        if let Some(create) = opts.create {
            let mut create_map = serde_json::Map::new();
            if let Some(tags) = create.tags {
                let mut tag_map = serde_json::Map::new();
                for (key, value) in tags {
                    tag_map.insert(key, Value::String(value));
                }
                create_map.insert("tags".to_string(), Value::Object(tag_map));
            }
            if let Some(region) = create.region {
                create_map.insert("region".to_string(), Value::String(region));
            }
            req_body.insert("create".to_string(), Value::Object(create_map));
        }

        let body = json!({
            "query": {
                "getOrCreateForTags": req_body
            },
        });
        let res_json = self.post_manager_endpoint("/manager/actors", body).await?;
        let Some(endpoint) = res_json["endpoint"].as_str() else {
            return Err(anyhow::anyhow!("No endpoint returned. Request failed? {:?}", res_json));
        };

        let handle = ActorHandleInner::new(
            endpoint.to_string(),
            self.transport_kind,
            self.encoding_kind,
            opts.params
        )?;
        handle.start_connection().await;

        Ok(handle)
    }


    pub async fn get_with_id(
        &self,
        actor_id: &str,
        opts: GetWithIdOptions
    ) -> Result<ActorHandle> {
        let body = json!({
            "query": {
                "getForId": {
                    "actorId": actor_id,
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
            self.encoding_kind,
            opts.params
        )?;
        handle.start_connection().await;
    
        Ok(handle)
    }
    
    pub async fn create(
        &self,
        name: &str,
        opts: CreateOptions
    ) -> Result<ActorHandle> {
        let mut tag_map = serde_json::Map::new();
    
        for (key, value) in opts.create.tags {
            tag_map.insert(key, Value::String(value));
        }
    
        let mut req_body = serde_json::Map::new();
        req_body.insert("name".to_string(), Value::String(name.to_string()));
        req_body.insert("tags".to_string(), Value::Object(tag_map));
        if let Some(region) = opts.create.region {
            req_body.insert("region".to_string(), Value::String(region));
        }

        let body = json!({
            "query": {
                "create": req_body
            },
        });
        let res_json = self.post_manager_endpoint("/manager/actors", body).await?;
        let Some(endpoint) = res_json["endpoint"].as_str() else {
            return Err(anyhow::anyhow!("No endpoint returned. Request failed? {:?}", res_json));
        };
    
        let handle = ActorHandleInner::new(
            endpoint.to_string(),
            self.transport_kind,
            self.encoding_kind,
            opts.params
        )?;
        handle.start_connection().await;
    
        Ok(handle)
    } 
}
