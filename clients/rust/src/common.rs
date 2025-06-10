use anyhow::Result;
use reqwest::{header::USER_AGENT, RequestBuilder};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value as JsonValue};
use tracing::debug;

use crate::protocol::query::ActorQuery;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const USER_AGENT_VALUE: &str = concat!("ActorClient-Rust/", env!("CARGO_PKG_VERSION"));

pub const HEADER_ACTOR_QUERY: &str = "X-AC-Query";
pub const HEADER_ENCODING: &str = "X-AC-Encoding";
pub const HEADER_CONN_PARAMS: &str = "X-AC-Conn-Params";
pub const HEADER_ACTOR_ID: &str = "X-AC-Actor";
pub const HEADER_CONN_ID: &str = "X-AC-Conn";
pub const HEADER_CONN_TOKEN: &str = "X-AC-Conn-Token";

#[derive(Debug, Clone, Copy)]
pub enum TransportKind {
    WebSocket,
    Sse,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncodingKind {
    Json,
    Cbor,
}

impl EncodingKind {
    pub fn as_str(&self) -> &str {
        match self {
            EncodingKind::Json => "json",
            EncodingKind::Cbor => "cbor",
        }
    }
}

impl ToString for EncodingKind {
    fn to_string(&self) -> String {
        self.as_str().to_string()
    }
}



// Max size of each entry is 128 bytes
pub type ActorKey = Vec<String>;

pub struct HttpRequestOptions<'a, T: Serialize> {
    pub method: &'a str,
    pub url: &'a str,
    pub headers: Vec<(&'a str, String)>,
    pub body: Option<T>,
    pub encoding_kind: EncodingKind
}

impl<'a, T: Serialize> Default for HttpRequestOptions<'a, T> {
    fn default() -> Self {
        Self {
            method: "GET",
            url: "",
            headers: Vec::new(),
            body: None,
            encoding_kind: EncodingKind::Json
        }
    }
}

fn build_http_request<RQ>(opts: &HttpRequestOptions<RQ>) -> Result<RequestBuilder>
where
    RQ: Serialize
{
    let client = reqwest::Client::new();
    let mut req = client.request(
        reqwest::Method::from_bytes(opts.method.as_bytes()).unwrap(),
        opts.url,
    );

    for (key, value) in &opts.headers {
        req = req.header(*key, value);
    }
    
    if opts.method == "POST" || opts.method == "PUT" {
        let Some(body) = &opts.body else {
            return Err(anyhow::anyhow!("Body is required for POST/PUT requests"));
        };

        match opts.encoding_kind {
            EncodingKind::Json => {
                req = req.header("Content-Type", "application/json");
                let body = serde_json::to_string(&body)?;
                req = req.body(body);
            }
            EncodingKind::Cbor => {
                req = req.header("Content-Type", "application/octet-stream");
                let body =serde_cbor::to_vec(&body)?;
                req = req.body(body);
            }
        }
    };

    req = req.header(USER_AGENT, USER_AGENT_VALUE);

    Ok(req)
}

async fn send_http_request_raw(req: reqwest::RequestBuilder) -> Result<reqwest::Response> {
    let res = req.send().await?;

    if !res.status().is_success() {
        // TODO: Decode
        /*
        let data: Option<RpcResponseError> = match opts.encoding_kind {
            EncodingKind::Json => {
                let data = res.text().await?;
                
                serde_json::from_str::<RpcResponseError>(&data).ok()
            }
            EncodingKind::Cbor => {
                let data = res.bytes().await?;
                
                serde_cbor::from_slice(&data).ok()
            }
        };

        match data {
            Some(data) => {
                return Err(anyhow::anyhow!(
                    "HTTP request failed with status: {}, error: {}",
                    res.status(),
                    data.m
                ));
            },
            None => {

            }
        }
        */
        return Err(anyhow::anyhow!(
            "HTTP request failed with status: {}",
            res.status()
        ));
    }

    Ok(res)
}

pub async fn send_http_request<'a, RQ, RS>(opts: HttpRequestOptions<'a, RQ>) -> Result<RS>
where
    RQ: Serialize,
    RS: DeserializeOwned,
{
    let req = build_http_request(&opts)?;
    let res = send_http_request_raw(req).await?;

    let res: RS = match opts.encoding_kind {
        EncodingKind::Json => {
            let data = res.text().await?;
            serde_json::from_str(&data)?
        }
        EncodingKind::Cbor => {
            let bytes = res.bytes().await?;
            serde_cbor::from_slice(&bytes)?
        }
    };

    Ok(res)
}


pub async fn resolve_actor_id(
    manager_endpoint: &str,
    query: ActorQuery,
    encoding_kind: EncodingKind
) -> Result<String> {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct ResolveResponse {
        i: String,
    }

    let query = serde_json::to_string(&query)?;

    let res = send_http_request::<JsonValue, ResolveResponse>(
        HttpRequestOptions {
            method: "POST",
            url: &format!("{}/actors/resolve", manager_endpoint),
            headers: vec![
                (HEADER_ENCODING, encoding_kind.to_string()),
                (HEADER_ACTOR_QUERY, query),
            ],
            body: Some(json!({})),
            encoding_kind,
        }
    ).await?;

    Ok(res.i)
}