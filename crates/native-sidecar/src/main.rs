use std::os::fd::{FromRawFd, OwnedFd};

use nix::fcntl::{fcntl, FcntlArg};

const CONTROL_FD: i32 = 3;

fn parse_runtime_config(
    mut args: impl Iterator<Item = String>,
) -> Result<agentos_runtime::RuntimeConfig, String> {
    let mut config = agentos_runtime::RuntimeConfig::default();
    while let Some(argument) = args.next() {
        let value = if argument == "--max-active-vms" {
            args.next()
                .ok_or_else(|| String::from("--max-active-vms requires a positive integer"))?
        } else if let Some(value) = argument.strip_prefix("--max-active-vms=") {
            value.to_owned()
        } else {
            return Err(format!("unknown agentOS sidecar argument: {argument}"));
        };
        let maximum = value.parse::<usize>().map_err(|_| {
            format!("--max-active-vms must be a positive integer, received {value:?}")
        })?;
        if maximum == 0 {
            return Err(String::from(
                "--max-active-vms must be greater than zero when configured",
            ));
        }
        config.max_active_vm_executors = Some(maximum);
    }
    config.validate().map_err(|error| error.to_string())?;
    Ok(config)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Entrypoint {
    Actor,
    Sidecar,
}

fn parse_entrypoint(args: &mut impl Iterator<Item = String>) -> Result<Entrypoint, String> {
    match args.next().as_deref() {
        None | Some("sidecar") => Ok(Entrypoint::Sidecar),
        Some("actor") => Ok(Entrypoint::Actor),
        Some(argument) => Err(format!(
            "unknown agentOS entry point {argument:?}; expected 'actor' or 'sidecar'"
        )),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ActorProcessOptions {
    package_cache: agentos_client::ProcessPackageCacheOptions,
    preload: agentos_actor::PreloadProcessOptions,
}

fn parse_actor_options(
    mut args: impl Iterator<Item = String>,
) -> Result<ActorProcessOptions, String> {
    let mut package_cache = agentos_client::ProcessPackageCacheOptions::default();
    let mut preload = agentos_actor::PreloadProcessOptions::default();
    while let Some(argument) = args.next() {
        let (name, inline_value) = argument
            .split_once('=')
            .map_or((argument.as_str(), None), |(name, value)| {
                (name, Some(value.to_owned()))
            });
        let value = match inline_value {
            Some(value) => value,
            None => args
                .next()
                .ok_or_else(|| format!("{name} requires a positive integer"))?,
        };
        match name {
            "--package-cache-max-bytes" => {
                package_cache.max_bytes = parse_positive_actor_option(name, &value)?;
            }
            "--package-cache-max-entries" => {
                package_cache.max_entries = parse_positive_actor_option(name, &value)?;
            }
            "--package-cache-max-concurrent-acquisitions" => {
                package_cache.max_concurrent_acquisitions =
                    parse_positive_actor_option(name, &value)?;
            }
            "--package-cache-max-pending-acquisitions" => {
                package_cache.max_pending_acquisitions = parse_positive_actor_option(name, &value)?;
            }
            "--package-cache-acquisition-timeout-ms" => {
                package_cache.acquisition_timeout_ms = parse_positive_actor_option(name, &value)?;
            }
            "--package-cache-max-source-entries" => {
                package_cache.max_source_entries = parse_positive_actor_option(name, &value)?;
            }
            "--package-cache-source-ttl-ms" => {
                package_cache.source_ttl_ms = parse_positive_actor_option(name, &value)?;
            }
            "--preload-startup-deadline-ms" => {
                preload.startup_deadline_ms = parse_positive_actor_option(name, &value)?;
            }
            "--preload-plan-read-timeout-ms" => {
                preload.plan_read_timeout_ms = parse_positive_actor_option(name, &value)?;
            }
            "--preload-max-plan-entries" => {
                preload.max_plan_entries = parse_positive_actor_option(name, &value)?;
            }
            "--preload-max-plan-bytes" => {
                preload.max_plan_bytes = parse_positive_actor_option(name, &value)?;
            }
            "--preload-warm-concurrency" => {
                preload.warm_concurrency = parse_positive_actor_option(name, &value)?;
            }
            "--preload-max-observation-entries" => {
                preload.max_observation_entries = parse_positive_actor_option(name, &value)?;
            }
            "--preload-flush-interval-ms" => {
                preload.flush_interval_ms = parse_positive_actor_option(name, &value)?;
            }
            "--preload-action-timeout-ms" => {
                preload.action_timeout_ms = parse_positive_actor_option(name, &value)?;
            }
            _ => return Err(format!("unknown agentOS actor argument: {argument}")),
        }
    }
    package_cache
        .validate()
        .map_err(|error| format!("invalid agentOS actor package cache configuration: {error}"))?;
    preload
        .validate()
        .map_err(|error| format!("invalid agentOS actor preload configuration: {error:#}"))?;
    Ok(ActorProcessOptions {
        package_cache,
        preload,
    })
}

fn parse_positive_actor_option<T>(name: &str, value: &str) -> Result<T, String>
where
    T: std::str::FromStr + PartialEq + From<u8>,
{
    let parsed = value
        .parse::<T>()
        .map_err(|_| format!("{name} requires a positive integer, received {value:?}"))?;
    if parsed == T::from(0) {
        return Err(format!("{name} must be greater than zero"));
    }
    Ok(parsed)
}

fn main() {
    // Default to WARN so near-limit / backpressure warnings actually surface
    // (they were swallowed at ERROR-only); operators can tune via AGENTOS_LOG
    // (e.g. `error` to quiet, `debug` for queue snapshots). Logs MUST go to stderr:
    // stdout is the framed wire-protocol channel, so logging there would corrupt it.
    let level = std::env::var("AGENTOS_LOG")
        .ok()
        .and_then(|value| value.parse::<tracing::Level>().ok())
        .unwrap_or(tracing::Level::WARN);
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_max_level(level)
        .init();
    let mut args = std::env::args().skip(1);
    let entrypoint = match parse_entrypoint(&mut args) {
        Ok(entrypoint) => entrypoint,
        Err(error) => {
            tracing::error!(%error, "invalid agentOS executable entry point");
            std::process::exit(2);
        }
    };
    let result = match entrypoint {
        Entrypoint::Actor => run_actor(args),
        Entrypoint::Sidecar => run_sidecar(args),
    };
    if let Err(error) = result {
        tracing::error!(?error, "agentOS executable failed");
        std::process::exit(1);
    }
}

fn run_actor(args: impl Iterator<Item = String>) -> Result<(), String> {
    let options = parse_actor_options(args)?;
    agentos_client::configure_process_package_cache(options.package_cache)
        .map_err(|error| format!("configure agentOS process package cache: {error}"))?;
    agentos_actor::configure_process_preload(options.preload)
        .map_err(|error| format!("configure agentOS process preload: {error:#}"))?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("build agentOS actor runtime: {error}"))?;
    runtime
        .block_on(agentos_actor::registry().start())
        .map_err(|error| format!("run agentOS actor: {error:#}"))
}

fn run_sidecar(args: impl Iterator<Item = String>) -> Result<(), String> {
    if let Err(error) = fcntl(CONTROL_FD, FcntlArg::F_GETFD) {
        tracing::error!(
            ?error,
            fd = CONTROL_FD,
            "missing inherited sidecar response/control descriptor"
        );
        return Err(format!(
            "missing inherited sidecar response/control descriptor: {error}"
        ));
    }
    let runtime_config = parse_runtime_config(args)?;
    // SAFETY: the process launch contract reserves fd 3 for the inherited
    // response/control socket and transfers its sole ownership to the sidecar.
    // The fcntl probe above establishes that the descriptor is open before it
    // is adopted.
    let control_fd = unsafe { OwnedFd::from_raw_fd(CONTROL_FD) };
    agentos_native_sidecar::stdio::run_with_runtime_config(control_fd, runtime_config)
        .map_err(|error| format!("run agentOS native sidecar: {error:#}"))
}

#[cfg(test)]
mod tests {
    use super::{parse_actor_options, parse_entrypoint, parse_runtime_config, Entrypoint};

    #[test]
    fn executable_entrypoints_are_fixed() {
        assert_eq!(
            parse_entrypoint(&mut std::iter::empty()).expect("default entrypoint"),
            Entrypoint::Sidecar
        );
        assert_eq!(
            parse_entrypoint(&mut [String::from("actor")].into_iter()).expect("actor entrypoint"),
            Entrypoint::Actor
        );
        assert!(parse_entrypoint(&mut [String::from("unknown")].into_iter())
            .expect_err("unknown entrypoint must fail")
            .contains("expected 'actor' or 'sidecar'"));
    }

    #[test]
    fn runtime_executor_limit_is_uncapped_by_default_and_configurable() {
        let default = parse_runtime_config(std::iter::empty()).expect("parse default config");
        assert_eq!(default.max_active_vm_executors, None);

        let configured =
            parse_runtime_config([String::from("--max-active-vms"), String::from("7")].into_iter())
                .expect("parse configured executor limit");
        assert_eq!(configured.max_active_vm_executors, Some(7));

        let error = parse_runtime_config([String::from("--max-active-vms=0")].into_iter())
            .expect_err("zero executor limit must fail");
        assert!(error.contains("greater than zero"));
    }

    #[test]
    fn actor_package_cache_limits_are_startup_only_and_bounded() {
        let options = parse_actor_options(
            [
                String::from("--package-cache-max-bytes=1024"),
                String::from("--package-cache-max-entries"),
                String::from("4"),
                String::from("--package-cache-max-concurrent-acquisitions=2"),
                String::from("--package-cache-max-pending-acquisitions=8"),
                String::from("--package-cache-acquisition-timeout-ms=9000"),
                String::from("--package-cache-max-source-entries=16"),
                String::from("--package-cache-source-ttl-ms=30000"),
                String::from("--preload-startup-deadline-ms=5000"),
                String::from("--preload-plan-read-timeout-ms=1000"),
                String::from("--preload-max-plan-entries=8"),
                String::from("--preload-max-plan-bytes=2048"),
                String::from("--preload-warm-concurrency=2"),
                String::from("--preload-max-observation-entries=6"),
                String::from("--preload-flush-interval-ms=60000"),
                String::from("--preload-action-timeout-ms=2000"),
            ]
            .into_iter(),
        )
        .expect("parse actor package cache limits");
        assert_eq!(options.package_cache.max_bytes, 1024);
        assert_eq!(options.package_cache.max_entries, 4);
        assert_eq!(options.package_cache.max_concurrent_acquisitions, 2);
        assert_eq!(options.package_cache.max_pending_acquisitions, 8);
        assert_eq!(options.package_cache.acquisition_timeout_ms, 9000);
        assert_eq!(options.package_cache.max_source_entries, 16);
        assert_eq!(options.package_cache.source_ttl_ms, 30000);
        assert_eq!(options.preload.startup_deadline_ms, 5000);
        assert_eq!(options.preload.plan_read_timeout_ms, 1000);
        assert_eq!(options.preload.max_plan_entries, 8);
        assert_eq!(options.preload.max_plan_bytes, 2048);
        assert_eq!(options.preload.warm_concurrency, 2);
        assert_eq!(options.preload.max_observation_entries, 6);
        assert_eq!(options.preload.flush_interval_ms, 60000);
        assert_eq!(options.preload.action_timeout_ms, 2000);
        assert!(
            parse_actor_options([String::from("--package-cache-max-entries=0")].into_iter())
                .is_err()
        );
        assert!(parse_actor_options(
            [
                String::from("--package-cache-max-concurrent-acquisitions=9"),
                String::from("--package-cache-max-pending-acquisitions=8"),
            ]
            .into_iter()
        )
        .is_err());
    }
}
