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

fn run_actor(mut args: impl Iterator<Item = String>) -> Result<(), String> {
    if let Some(argument) = args.next() {
        return Err(format!("unknown agentOS actor argument: {argument}"));
    }
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
    use super::{parse_entrypoint, parse_runtime_config, Entrypoint};

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
}
