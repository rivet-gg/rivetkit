// cargo test -- --nocapture

pub mod client;
pub mod handle;
pub mod protocol;
pub mod drivers;
pub mod encoding;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    
    #[tokio::test]
    async fn basic() {
        const ENDPOINT: &str = "http://localhost:8787";

        let client = client::Client::new(
            ENDPOINT.to_string(),
            drivers::TransportKind::WebSocket,
            encoding::EncodingKind::Json
        ); 
        let counter = client.get(vec![
            ("name".to_string(), "counter".to_string())
        ]).await.unwrap();

        counter.on_event("newCount", |args| {
            let new_count = args[0].as_i64().unwrap();
            println!("New count: {:?}", new_count);
        }).await.unwrap();

        let out = counter.rpc("increment", vec![
            json!(1)
        ]).await.unwrap();
        println!("RPC: {:?}", out);

        // handle.transport_driver.send_raw(b"{\"body\":{\"sr\":{\"e\":\"countUpdate\",\"s\":true}}}").await;
        // handle.transport_driver.send_raw(b"{\"body\":{\"rr\":{\"i\":0,\"n\":\"increment\",\"a\":[1]}}}").await;)
    
    }
}
