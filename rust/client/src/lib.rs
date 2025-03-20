// cargo test -- --nocapture

mod backoff;
pub mod client;
pub mod handle;
pub mod protocol;
pub mod drivers;
pub mod encoding;

#[cfg(test)]
mod tests {
    use crate::client::GetOptions;

    use super::*;
    use serde_json::json;
    use tokio::signal;
    use tracing::Level;
    use tracing_subscriber::fmt;
    
    #[tokio::test]
    async fn basic() {
        fmt()
            .with_max_level(Level::DEBUG)
            .init();
        const ENDPOINT: &str = "http://localhost:6420";

        let client = client::Client::new(
            ENDPOINT.to_string(),
            drivers::TransportKind::Sse,
            encoding::EncodingKind::Json
        ); 
        let counter = client.get("counter", GetOptions::default()).await.unwrap();
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
