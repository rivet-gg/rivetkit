use std::sync::Arc;

use anyhow::{anyhow, bail, Context, Result};
use rivetkit::{Action, CronSetOptions, Ctx, Handles};
use serde::{Deserialize, Serialize};

use crate::actions::BoxFuture;
use crate::events::CronFiredEvent;
use crate::process::{validate_arguments, validate_command, ActorSpawnOptions};
use crate::{AgentOsActor, ProcessSpawn};

const PRIVATE_CRON_ACTION: &str = "__agentos.cron.invoke";
const MAX_CRON_JOBS: usize = 1_024;
const MAX_CRON_NAME_BYTES: usize = 256;
const MAX_CRON_EXPRESSION_BYTES: usize = 256;
const MAX_TIMEZONE_BYTES: usize = 128;
const MAX_CRON_ARGUMENT_BYTES: usize = 64 * 1024;
const DEFAULT_CRON_HISTORY: i64 = 32;
const MAX_CRON_HISTORY: i64 = 256;
const MAX_CRON_ERROR_BYTES: usize = 16 * 1024;

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CronSchedule {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub expression: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub options: ActorSpawnOptions,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_history: Option<i64>,
}

impl Action for CronSchedule {
    type Output = ActorCronJob;
    const NAME: &'static str = "cron.schedule";
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CronList;

impl Action for CronList {
    type Output = Vec<ActorCronJob>;
    const NAME: &'static str = "cron.list";
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CronCancel {
    pub name: String,
}

impl Action for CronCancel {
    type Output = bool;
    const NAME: &'static str = "cron.cancel";
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorCronJob {
    pub name: String,
    pub expression: String,
    pub timezone: Option<String>,
    pub command: String,
    pub args: Vec<String>,
    pub options: ActorSpawnOptions,
    pub config_revision: u64,
    pub next_run_at: i64,
    pub last_run_at: Option<i64>,
    pub max_history: i64,
}

#[cfg_attr(feature = "contract", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CronInvoke {
    pub schedule_name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub options: ActorSpawnOptions,
    pub config_revision: u64,
}

impl Action for CronInvoke {
    type Output = ();
    const NAME: &'static str = PRIVATE_CRON_ACTION;
}

impl Handles<CronSchedule> for AgentOsActor {
    type Future = BoxFuture<ActorCronJob>;

    fn handle(self: Arc<Self>, ctx: Ctx<Self>, action: CronSchedule) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            let current = ctx.cron().list().await?;
            if current.len() >= MAX_CRON_JOBS {
                let replacing = action
                    .name
                    .as_ref()
                    .is_some_and(|name| current.iter().any(|job| &job.name == name));
                if !replacing {
                    bail!(
                        "limit_exceeded: actor has {} cron jobs; maximum is {MAX_CRON_JOBS}; cancel a job before scheduling another",
                        current.len()
                    );
                }
            }
            let name = action
                .name
                .unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string());
            validate_nonempty_bytes("cron name", &name, MAX_CRON_NAME_BYTES)?;
            validate_nonempty_bytes(
                "cron expression",
                &action.expression,
                MAX_CRON_EXPRESSION_BYTES,
            )?;
            if let Some(timezone) = &action.timezone {
                validate_nonempty_bytes("cron timezone", timezone, MAX_TIMEZONE_BYTES)?;
            }
            validate_command(&action.command)?;
            validate_arguments(&action.args)?;
            action.options.validate()?;
            let max_history = action.max_history.unwrap_or(DEFAULT_CRON_HISTORY);
            if !(0..=MAX_CRON_HISTORY).contains(&max_history) {
                bail!("limit_exceeded: cron maxHistory must be between 0 and {MAX_CRON_HISTORY}");
            }
            let config_revision = self.snapshot().await.revision;
            let invocation = CronInvoke {
                schedule_name: name.clone(),
                command: action.command,
                args: action.args,
                options: action.options,
                config_revision,
            };
            let args = rivetkit::action::encode_positional(&invocation)
                .context("encode private cron invocation")?;
            if args.len() > MAX_CRON_ARGUMENT_BYTES {
                bail!(
                    "limit_exceeded: encoded cron action is {} bytes; maximum is {MAX_CRON_ARGUMENT_BYTES}",
                    args.len()
                );
            }
            ctx.cron()
                .set(CronSetOptions {
                    name: &name,
                    expression: &action.expression,
                    timezone: action.timezone.as_deref(),
                    action: PRIVATE_CRON_ACTION,
                    args: &args,
                    max_history: Some(max_history),
                })
                .await
                .context("schedule RivetKit cron job")?;
            let info = ctx
                .cron()
                .get(&name)
                .await?
                .ok_or_else(|| anyhow!("scheduled cron job {name:?} was not found"))?;
            actor_cron_job(info)
        })
    }
}

impl Handles<CronList> for AgentOsActor {
    type Future = BoxFuture<Vec<ActorCronJob>>;

    fn handle(self: Arc<Self>, ctx: Ctx<Self>, _action: CronList) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            let jobs = ctx.cron().list().await?;
            if jobs.len() > MAX_CRON_JOBS {
                bail!(
                    "limit_exceeded: RivetKit returned {} cron jobs; maximum is {MAX_CRON_JOBS}",
                    jobs.len()
                );
            }
            jobs.into_iter()
                .filter(|job| job.action == PRIVATE_CRON_ACTION)
                .map(actor_cron_job)
                .collect()
        })
    }
}

impl Handles<CronCancel> for AgentOsActor {
    type Future = BoxFuture<bool>;

    fn handle(self: Arc<Self>, ctx: Ctx<Self>, action: CronCancel) -> Self::Future {
        Box::pin(async move {
            let _permit = self.admit_action()?;
            validate_nonempty_bytes("cron name", &action.name, MAX_CRON_NAME_BYTES)?;
            ctx.cron().delete(&action.name).await
        })
    }
}

impl Handles<CronInvoke> for AgentOsActor {
    type Future = BoxFuture<()>;

    fn handle(self: Arc<Self>, ctx: Ctx<Self>, action: CronInvoke) -> Self::Future {
        Box::pin(async move {
            validate_nonempty_bytes(
                "cron schedule name",
                &action.schedule_name,
                MAX_CRON_NAME_BYTES,
            )?;
            validate_command(&action.command)?;
            validate_arguments(&action.args)?;
            action.options.validate()?;
            let current_revision = self.snapshot().await.revision;
            if action.config_revision != current_revision {
                let error = format!(
                    "stale_config_revision: cron job was validated at revision {} but current revision is {current_revision}",
                    action.config_revision
                );
                emit_cron_failure(&ctx, &action.schedule_name, &error)?;
                bail!(error);
            }

            let schedule_name = action.schedule_name;
            let process = ProcessSpawn {
                command: action.command,
                args: action.args,
                options: action.options,
            };
            match <AgentOsActor as Handles<ProcessSpawn>>::handle(self, ctx.clone(), process).await
            {
                Ok(process) => {
                    ctx.emit(CronFiredEvent {
                        schedule_name,
                        process: Some(process),
                        error: None,
                        fired_at_ms: crate::runtime::now_ms()?,
                    })?;
                    Ok(())
                }
                Err(error) => {
                    emit_cron_failure(&ctx, &schedule_name, &error.to_string())?;
                    Err(error)
                }
            }
        })
    }
}

fn actor_cron_job(info: rivetkit::context::CronJobInfo) -> Result<ActorCronJob> {
    if info.action != PRIVATE_CRON_ACTION {
        bail!(
            "invalid_input: cron job {:?} is not an agentOS command job",
            info.name
        );
    }
    let invocation: CronInvoke = rivetkit::action::decode_positional(&info.args)
        .with_context(|| format!("decode cron job {:?} invocation", info.name))?;
    let expression = info
        .expression
        .ok_or_else(|| anyhow!("cron job {:?} has no expression", info.name))?;
    Ok(ActorCronJob {
        name: info.name,
        expression,
        timezone: info.timezone,
        command: invocation.command,
        args: invocation.args,
        options: invocation.options,
        config_revision: invocation.config_revision,
        next_run_at: info.next_run_at,
        last_run_at: info.last_run_at,
        max_history: info.max_history,
    })
}

fn emit_cron_failure(ctx: &Ctx<AgentOsActor>, schedule_name: &str, error: &str) -> Result<()> {
    ctx.emit(CronFiredEvent {
        schedule_name: schedule_name.to_owned(),
        process: None,
        error: Some(bounded_error(error)),
        fired_at_ms: crate::runtime::now_ms()?,
    })
}

fn bounded_error(error: &str) -> String {
    if error.len() <= MAX_CRON_ERROR_BYTES {
        return error.to_owned();
    }
    let mut end = MAX_CRON_ERROR_BYTES;
    while !error.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &error[..end])
}

fn validate_nonempty_bytes(label: &str, value: &str, max: usize) -> Result<()> {
    if value.is_empty() {
        bail!("invalid_input: {label} cannot be empty");
    }
    if value.len() > max {
        bail!(
            "limit_exceeded: {label} is {} bytes; maximum is {max} bytes",
            value.len()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_cron_payload_round_trips_through_positional_cbor() {
        let action = CronInvoke {
            schedule_name: String::from("nightly"),
            command: String::from("echo"),
            args: vec![String::from("hello")],
            options: ActorSpawnOptions::default(),
            config_revision: 7,
        };
        let encoded = rivetkit::action::encode_positional(&action).expect("encode cron action");
        let decoded: CronInvoke =
            rivetkit::action::decode_positional(&encoded).expect("decode cron action");
        assert_eq!(decoded, action);
    }

    #[test]
    fn cron_errors_are_utf8_bounded() {
        let error = "🦀".repeat(MAX_CRON_ERROR_BYTES);
        let bounded = bounded_error(&error);
        assert!(bounded.len() <= MAX_CRON_ERROR_BYTES + '…'.len_utf8());
        assert!(bounded.ends_with('…'));
    }
}
