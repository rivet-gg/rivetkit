use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use anyhow::{Context, Result};
use rivetkit::{Action, ActionEntry, ActionSet, Ctx, Handles};

use crate::filesystem::{
    FilesystemExists, FilesystemExport, FilesystemListMounts, FilesystemMkdir, FilesystemMove,
    FilesystemReadFile, FilesystemReadFiles, FilesystemReaddir, FilesystemReaddirEntries,
    FilesystemReaddirRecursive, FilesystemRemove, FilesystemStat, FilesystemWriteFile,
    FilesystemWriteFiles,
};
use crate::language::*;
use crate::process::{
    ProcessCloseStdin, ProcessExec, ProcessExecFile, ProcessGet, ProcessList, ProcessReadOutput,
    ProcessResizePty, ProcessSignal, ProcessSpawn, ProcessTree, ProcessWait, ProcessWriteStdin,
    TerminalClose, TerminalList, TerminalOpen, TerminalResize, TerminalSnapshot, TerminalWait,
    TerminalWrite,
};
use crate::{AgentOsActor, ConfigGet, RuntimeRestart, RuntimeStatusGet};

type DispatchFuture = Pin<Box<dyn Future<Output = Result<Vec<u8>>> + Send>>;

/// Product-owned typed action registry.
///
/// This is intentionally independent of RivetKit's tuple implementations so
/// the agentOS contract can grow without turning API groups into raw router
/// actions. Step 12 consumes this same registry for prototype TypeScript
/// binding generation.
pub struct AgentOsActionSet;

fn dispatch_typed<A>(
    actor: Arc<AgentOsActor>,
    ctx: Ctx<AgentOsActor>,
    args: &[u8],
) -> DispatchFuture
where
    A: Action,
    AgentOsActor: Handles<A>,
{
    let args = args.to_vec();
    Box::pin(async move {
        let action = rivetkit::action::decode_positional::<A>(&args)
            .with_context(|| format!("decode action '{}' args", A::NAME))?;
        let output = <AgentOsActor as Handles<A>>::handle(actor, ctx, action).await?;
        let mut encoded = Vec::new();
        ciborium::into_writer(&output, &mut encoded).context("encode action response as cbor")?;
        Ok(encoded)
    })
}

macro_rules! action_registry {
    ($($action:ty),+ $(,)?) => {
        impl ActionSet<AgentOsActor> for AgentOsActionSet {
            fn entries() -> Vec<ActionEntry<AgentOsActor>> {
                vec![$(ActionEntry::new(<$action as Action>::NAME)),+]
            }

            fn dispatch(
                actor: Arc<AgentOsActor>,
                ctx: Ctx<AgentOsActor>,
                name: &str,
                args: &[u8],
            ) -> Option<DispatchFuture> {
                $(
                    if name == <$action as Action>::NAME {
                        return Some(dispatch_typed::<$action>(actor, ctx, args));
                    }
                )+
                None
            }
        }
    };
}

action_registry!(
    ConfigGet,
    RuntimeStatusGet,
    RuntimeRestart,
    FilesystemReadFile,
    FilesystemWriteFile,
    FilesystemReadFiles,
    FilesystemWriteFiles,
    FilesystemStat,
    FilesystemMkdir,
    FilesystemReaddir,
    FilesystemReaddirEntries,
    FilesystemReaddirRecursive,
    FilesystemExists,
    FilesystemMove,
    FilesystemRemove,
    FilesystemExport,
    FilesystemListMounts,
    ProcessExec,
    ProcessExecFile,
    ProcessSpawn,
    ProcessGet,
    ProcessList,
    ProcessTree,
    ProcessWait,
    ProcessSignal,
    ProcessWriteStdin,
    ProcessCloseStdin,
    ProcessResizePty,
    ProcessReadOutput,
    TerminalOpen,
    TerminalList,
    TerminalSnapshot,
    TerminalWrite,
    TerminalResize,
    TerminalWait,
    TerminalClose,
    ContextsCreate,
    ContextsGet,
    ContextsList,
    ContextsReset,
    ContextsDelete,
    JavaScriptExecute,
    JavaScriptEvaluate,
    JavaScriptExecuteFile,
    JavaScriptSpawn,
    JavaScriptSpawnFile,
    JavaScriptNpmInstall,
    JavaScriptNpmRunScript,
    JavaScriptNpmRunPackage,
    TypeScriptExecute,
    TypeScriptEvaluate,
    TypeScriptExecuteFile,
    TypeScriptSpawn,
    TypeScriptSpawnFile,
    TypeScriptCheck,
    TypeScriptCheckProject,
    PythonExecute,
    PythonEvaluate,
    PythonExecuteFile,
    PythonExecuteModule,
    PythonSpawn,
    PythonSpawnFile,
    PythonSpawnModule,
    PythonInstall,
);
