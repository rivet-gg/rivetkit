use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use rivetkit::{BindParam, ColumnValue, Ctx};

use crate::{AgentOsActor, ConfigSnapshot};

const SCHEMA_VERSION: i64 = 1;
const TRANSACTION_TIMEOUT: Duration = Duration::from_secs(5);

pub(crate) async fn load_or_initialize(
    ctx: &Ctx<AgentOsActor>,
    initial: &ConfigSnapshot,
) -> Result<ConfigSnapshot> {
    migrate(ctx).await?;
    let result = ctx
        .sql()
        .query(
            "SELECT desired_config, revision, applied_revision, status, issues, created_at_ms, updated_at_ms
             FROM agentos_actor_config WHERE id = 1",
            None,
        )
        .await
        .context("load actor config")?;

    if let Some(row) = result.rows.first() {
        return decode_snapshot(row);
    }

    persist(ctx, initial).await?;
    Ok(initial.clone())
}

pub(crate) async fn persist(ctx: &Ctx<AgentOsActor>, snapshot: &ConfigSnapshot) -> Result<()> {
    let desired_config = serde_json::to_string(&snapshot.desired)
        .context("encode desired actor config for sqlite")?;
    let issues =
        serde_json::to_string(&snapshot.issues).context("encode actor config issues for sqlite")?;
    let applied_revision = snapshot
        .applied_revision
        .map(i64::try_from)
        .transpose()
        .context("applied config revision exceeds sqlite integer range")?;
    ctx.sql()
        .execute(
            "INSERT INTO agentos_actor_config (
                id, desired_config, revision, applied_revision, status, issues,
                created_at_ms, updated_at_ms
             ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                desired_config = excluded.desired_config,
                revision = excluded.revision,
                applied_revision = excluded.applied_revision,
                status = excluded.status,
                issues = excluded.issues,
                updated_at_ms = excluded.updated_at_ms",
            Some(vec![
                BindParam::Text(desired_config),
                BindParam::Integer(
                    i64::try_from(snapshot.revision)
                        .context("config revision exceeds sqlite integer range")?,
                ),
                applied_revision
                    .map(BindParam::Integer)
                    .unwrap_or(BindParam::Null),
                BindParam::Text(snapshot.status.as_str().to_owned()),
                BindParam::Text(issues),
                BindParam::Integer(snapshot.created_at_ms),
                BindParam::Integer(snapshot.updated_at_ms),
            ]),
        )
        .await
        .context("persist actor config")?;
    Ok(())
}

async fn migrate(ctx: &Ctx<AgentOsActor>) -> Result<()> {
    let transaction = ctx
        .sql()
        .begin_transaction(Some(TRANSACTION_TIMEOUT))
        .await
        .context("begin actor schema migration")?;
    let result = async {
        transaction
            .execute(
                "CREATE TABLE IF NOT EXISTS agentos_actor_schema_version (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    version INTEGER NOT NULL
                 ) STRICT",
                None,
            )
            .await
            .context("create actor schema version table")?;
        transaction
            .execute(
                "INSERT OR IGNORE INTO agentos_actor_schema_version (id, version) VALUES (1, 0)",
                None,
            )
            .await
            .context("initialize actor schema version")?;
        let version_result = transaction
            .exec("SELECT version FROM agentos_actor_schema_version WHERE id = 1")
            .await
            .context("read actor schema version")?;
        let version = version_result
            .rows
            .first()
            .and_then(|row| row.first())
            .and_then(column_integer)
            .ok_or_else(|| anyhow!("actor schema version row is missing or invalid"))?;

        match version {
            0 => {
                transaction
                    .execute(
                        "CREATE TABLE agentos_actor_config (
                            id INTEGER PRIMARY KEY CHECK (id = 1),
                            desired_config TEXT NOT NULL,
                            revision INTEGER NOT NULL CHECK (revision >= 1),
                            applied_revision INTEGER,
                            status TEXT NOT NULL,
                            issues TEXT NOT NULL,
                            created_at_ms INTEGER NOT NULL,
                            updated_at_ms INTEGER NOT NULL
                         ) STRICT",
                        None,
                    )
                    .await
                    .context("create actor config table")?;
                transaction
                    .execute(
                        "UPDATE agentos_actor_schema_version SET version = 1 WHERE id = 1",
                        None,
                    )
                    .await
                    .context("advance actor schema version")?;
            }
            SCHEMA_VERSION => {}
            other => {
                bail!("unsupported agentOS actor schema version {other}; expected {SCHEMA_VERSION}")
            }
        }
        Result::<()>::Ok(())
    }
    .await;

    match result {
        Ok(()) => transaction
            .commit()
            .await
            .context("commit actor schema migration"),
        Err(error) => match transaction.rollback().await {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(error.context(format!(
                "rollback actor schema migration failed: {rollback_error:#}"
            ))),
        },
    }
}

fn decode_snapshot(row: &[ColumnValue]) -> Result<ConfigSnapshot> {
    let desired = serde_json::from_str(column_text(row.first(), "desired_config")?)
        .context("decode desired actor config from sqlite")?;
    let revision = integer_to_u64(column_integer_required(row.get(1), "revision")?, "revision")?;
    let applied_revision = match row.get(2) {
        Some(ColumnValue::Null) | None => None,
        value => Some(integer_to_u64(
            column_integer_required(value, "applied_revision")?,
            "applied_revision",
        )?),
    };
    let status = column_text(row.get(3), "status")?.parse()?;
    let issues = serde_json::from_str(column_text(row.get(4), "issues")?)
        .context("decode actor config issues from sqlite")?;
    Ok(ConfigSnapshot {
        revision,
        desired,
        applied_revision,
        status,
        issues,
        created_at_ms: column_integer_required(row.get(5), "created_at_ms")?,
        updated_at_ms: column_integer_required(row.get(6), "updated_at_ms")?,
    })
}

fn column_integer(value: &ColumnValue) -> Option<i64> {
    match value {
        ColumnValue::Integer(value) => Some(*value),
        _ => None,
    }
}

fn column_integer_required(value: Option<&ColumnValue>, name: &str) -> Result<i64> {
    value
        .and_then(column_integer)
        .ok_or_else(|| anyhow!("actor config column {name} is missing or not an integer"))
}

fn column_text<'a>(value: Option<&'a ColumnValue>, name: &str) -> Result<&'a str> {
    match value {
        Some(ColumnValue::Text(value)) => Ok(value),
        _ => bail!("actor config column {name} is missing or not text"),
    }
}

fn integer_to_u64(value: i64, name: &str) -> Result<u64> {
    u64::try_from(value).with_context(|| format!("actor config column {name} is negative"))
}
