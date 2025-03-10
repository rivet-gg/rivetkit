// cargo test -- --nocapture

mod backoff;
pub mod client;
pub mod handle;
pub mod protocol;
pub mod drivers;
pub mod encoding;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::signal;
    
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
        ], None).await.unwrap();
        counter.on_event("newCount", |args| {
            let new_count = args[0].as_i64().unwrap();
            println!("New count: {:?}", new_count);
        }).await;

        let out = counter.rpc("increment", vec![
            json!(1)
        ]).await.unwrap();
        println!("RPC: {:?}", out);

        // Keep running until Ctrl+C is pressed
        println!("Press Ctrl+C to exit");
        match signal::ctrl_c().await {
            Ok(()) => println!("Shutting down gracefully..."),
            Err(err) => eprintln!("Error: {}", err),
        }
        
        // Clean up
        counter.disconnect().await;

        println!("done");
    }
}
