# ActorCore Rust Client

_The Rust client for ActorCore, the Stateful Serverless Framework_

Use this client to connect to ActorCore services from Rust applications.

## Resources

- [Quickstart](https://actorcore.org/introduction)
- [Documentation](https://actorcore.org/clients/rust)
- [Examples](https://github.com/rivet-gg/actor-core/tree/main/examples)

## Getting Started

### Step 1: Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
actor-core-client = "0.1.0"
```

### Step 2: Connect to Actor

```rust
use actor_core_client::{client::{Client, GetOptions}, drivers::TransportKind, encoding::EncodingKind};
use serde_json::json;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Create a client connected to your ActorCore manager
    let client = Client::new(
        "http://localhost:6420".to_string(),
        TransportKind::Sse,
        EncodingKind::Json
    );

    // Connect to a chat room actor
    let chat_room = client.get("chat-room", GetOptions::default()).await?;

    // Listen for new messages
    chat_room.on_event("newMessage", |args| {
        let username = args[0].as_str().unwrap();
        let message = args[1].as_str().unwrap();
        println!("Message from {}: {}", username, message);
    }).await;

    // Send message to room
    chat_room.action("sendMessage", vec![
        json!("william"),
        json!("All the world's a stage.")
    ]).await?;

    // When finished
    chat_room.disconnect().await;

    Ok(())
}
```

### Supported Transport Methods

The Rust client supports multiple transport methods:

- `TransportKind::Sse`: Server-Sent Events
- `TransportKind::Ws`: WebSockets

### Supported Encodings

The Rust client supports multiple encoding formats:

- `EncodingKind::Json`: JSON encoding
- `EncodingKind::Cbor`: CBOR binary encoding

## Community & Support

- Join our [Discord](https://rivet.gg/discord)
- Follow us on [X](https://x.com/rivet_gg)
- Follow us on [Bluesky](https://bsky.app/profile/rivet.gg)
- File bug reports in [GitHub Issues](https://github.com/rivet-gg/actor-core/issues)
- Post questions & ideas in [GitHub Discussions](https://github.com/rivet-gg/actor-core/discussions)

## License

Apache 2.0
