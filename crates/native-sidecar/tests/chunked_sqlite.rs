use tempfile::tempdir;

// The included plugin only needs the mount context's runtime handle. Keep the
// integration test independent from the full native-sidecar service graph.
mod bridge {
    pub struct MountPluginContext<B> {
        pub runtime_context: agentos_runtime::RuntimeContext,
        pub database: Option<crate::vm_sqlite::SharedVmSqliteDatabase>,
        pub marker: std::marker::PhantomData<B>,
    }
}

#[allow(dead_code)]
#[path = "../src/vm_sqlite.rs"]
mod vm_sqlite;

#[allow(dead_code)]
mod subject {
    include!("../src/plugins/chunked_sqlite.rs");

    pub async fn exercise_persistence(database: SharedVmSqliteDatabase) {
        let first = SqliteMetadataStore::new(
            database.clone(),
            "test".to_owned(),
            DEFAULT_MAX_METADATA_BYTES,
        );
        let root = first.resolve("/").await.expect("resolve root");
        first
            .create(
                root.ino,
                "workspace",
                CreateInodeAttrs::directory(0o755, 1000, 1000),
            )
            .await
            .expect("create directory");

        let reopened = SqliteMetadataStore::new(
            database.clone(),
            "test".to_owned(),
            DEFAULT_MAX_METADATA_BYTES,
        );
        let workspace = reopened
            .resolve("/workspace")
            .await
            .expect("resolve persisted directory");
        assert_eq!(workspace.uid, 1000);

        let blocks = SqliteBlockStore::new(database, "test".to_owned());
        let first_key = BlockKey("first".to_owned());
        let copied_key = BlockKey("copied".to_owned());
        blocks
            .put(&first_key, b"persisted bytes")
            .await
            .expect("put block");
        assert_eq!(
            blocks.get(&first_key).await.expect("get block"),
            b"persisted bytes"
        );
        blocks
            .copy(&first_key, &copied_key)
            .await
            .expect("copy block");
        assert_eq!(
            blocks.get(&copied_key).await.expect("get copied block"),
            b"persisted bytes"
        );
    }
}

#[tokio::test]
async fn metadata_and_blocks_persist_through_local_sqlite_adapter() {
    let dir = tempdir().expect("tempdir");
    let runtime =
        agentos_runtime::SidecarRuntime::process(&agentos_runtime::RuntimeConfig::default())
            .expect("runtime");
    let database = vm_sqlite::resolve_vm_sqlite(
        &agentos_vm_config::VmSqliteDescriptor::SqliteFile {
            path: dir.path().join("state.sqlite").display().to_string(),
        },
        runtime.context(),
        128 * 1024 * 1024,
    )
    .await
    .expect("local SQLite adapter");
    subject::bootstrap_schema(database.as_ref())
        .await
        .expect("filesystem schema");
    subject::exercise_persistence(database).await;
}
