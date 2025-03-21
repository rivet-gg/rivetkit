use actor_core_client::{Client, EncodingKind, GetOptions, TransportKind};
use fs_extra;
use portpicker;
use serde_json::json;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tempfile;
use tokio::time::sleep;
use tracing::{error, info};

/// Manages a mock server process for testing
struct MockServer {
    child: Child,
    // Keep the tempdir alive until this struct is dropped
    _temp_dir: tempfile::TempDir,
}

impl MockServer {
    async fn start(port: u16) -> Self {
        // Get the repo root directory based on current file location
        let current_dir = std::env::current_dir().expect("Failed to get current directory");
        let repo_root = current_dir
            .ancestors()
            .find(|p| p.join("package.json").exists())
            .expect("Failed to find repo root");

        // Run `yarn build -F actor-core` in the root of this repo
        let status = Command::new("yarn")
            .args(["build", "-F", "actor-core"])
            .current_dir(&repo_root)
            .status()
            .expect("Failed to build actor-core");

        if !status.success() {
            panic!("Failed to build actor-core");
        }

        // Create a temporary directory for the test server
        let temp_dir = tempfile::tempdir().expect("Failed to create temp dir");
        let temp_path = temp_dir.path();
        println!("Created temp directory at: {}", temp_path.display());

        // Create vendor directory in the temp dir
        let vendor_dir = temp_path.join("vendor");
        std::fs::create_dir_all(&vendor_dir).expect("Failed to create vendor directory");

        // Define packages to pack
        let packages = [
            ("actor-core", repo_root.join("packages/actor-core")),
            ("nodejs", repo_root.join("packages/platforms/nodejs")),
            ("memory", repo_root.join("packages/drivers/memory")),
        ];

        // Pack each package to the vendor directory
        for (name, path) in packages.iter() {
            let output_path = vendor_dir.join(format!("actor-core-{}.tgz", name));
            println!(
                "Packing {} from {} to {}",
                name,
                path.display(),
                output_path.display()
            );

            let status = Command::new("yarn")
                .args(["pack", "--out", output_path.to_str().unwrap()])
                .current_dir(path)
                .status()
                .expect(&format!("Failed to pack {}", name));

            if !status.success() {
                panic!("Failed to pack {}", name);
            }
        }

        // Copy examples/counter to the temp dir
        let counter_dir = repo_root.join("examples/counter");
        let options = fs_extra::dir::CopyOptions::new();
        fs_extra::dir::copy(&counter_dir, temp_path, &options)
            .expect("Failed to copy counter example");

        // Create the server directory structure
        let server_dir = temp_path.join("counter");
        let server_script_path = server_dir.join("src/server.ts");

        // Write the server script
        let server_script = r#"
import { app } from "./index.ts";
import { serve } from "@actor-core/nodejs";

serve(app, { port: PORT });
"#
        .replace("PORT", &port.to_string());

        std::fs::write(&server_script_path, server_script).expect("Failed to write server script");

        // Write a new package.json with tarball dependencies
        let package_json_path = server_dir.join("package.json");
        let package_json = format!(
            r#"{{
    "name": "actor-core-rust-test",
    "packageManager": "yarn@4.2.2",
    "private": true,
    "type": "module",
    "dependencies": {{
        "actor-core": "file:{}",
        "@actor-core/nodejs": "file:{}",
        "@actor-core/memory": "file:{}"
    }},
    "devDependencies": {{
        "tsx": "^3.12.7"
    }}
}}"#,
            vendor_dir.join("actor-core-actor-core.tgz").display(),
            vendor_dir.join("actor-core-nodejs.tgz").display(),
            vendor_dir.join("actor-core-memory.tgz").display()
        );

        std::fs::write(&package_json_path, package_json).expect("Failed to write package.json");

        // Write a .yarnrc.yml file to use node-modules linker
        let yarnrc_path = server_dir.join(".yarnrc.yml");
        let yarnrc_content = "nodeLinker: node-modules\n";
        std::fs::write(&yarnrc_path, yarnrc_content).expect("Failed to write .yarnrc.yml");
        
        // Install dependencies
        let status = Command::new("yarn")
            .current_dir(&server_dir)
            .status()
            .expect("Failed to install dependencies");

        if !status.success() {
            panic!("Failed to install dependencies");
        }

        // Spawn the server process
        let child = Command::new("npx")
            .args(["tsx", "src/server.ts"])
            .current_dir(&server_dir)
            .spawn()
            .expect("Failed to spawn server process");

        Self {
            child,
            _temp_dir: temp_dir,
        }
    }
}

impl Drop for MockServer {
    fn drop(&mut self) {
        // Kill the server process
        if let Err(e) = self.child.kill() {
            error!("Failed to kill server: {}", e);
        }

        // Note: The temporary directory is automatically cleaned up when the tempfile::TempDir
        // value is dropped, which happens when the test finishes

        info!("Mock server terminated");
    }
}

#[tokio::test]
async fn e2e() {
    // Configure logging
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::DEBUG)
        .finish();
    let _guard = tracing::subscriber::set_default(subscriber);

    // Pick an available port
    let port = portpicker::pick_unused_port().expect("Failed to pick an unused port");
    info!("Using port {}", port);
    let endpoint = format!("http://127.0.0.1:{}", port);

    // Start the mock server
    let _server = MockServer::start(port).await;

    // Wait for server to start
    info!("Waiting for server to start...");
    sleep(Duration::from_secs(2)).await;
    
    // Create the client
    info!("Creating client to endpoint: {}", endpoint);
    let client = Client::new(endpoint, TransportKind::WebSocket, EncodingKind::Cbor);
    let counter = client.get("counter", GetOptions::default()).await.unwrap();
    counter
        .on_event("newCount", |args| {
            let new_count = args[0].as_i64().unwrap();
            println!("New count: {:?}", new_count);
        })
        .await;
    
    let out = counter.action("increment", vec![json!(1)]).await.unwrap();
    println!("Action: {:?}", out);
    
    // Clean up
    counter.disconnect().await;
}
