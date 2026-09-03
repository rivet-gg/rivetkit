//! Product-specific schema export consumed by `@rivet-dev/agentos-bindgen`.
//!
//! This intentionally stays local to agentOS. RivetKit owns transport and the
//! nested action proxy; this module only exposes the concrete Rust wire shapes.

use std::any::TypeId;
use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorContract {
    pub schema_version: u32,
    pub actor_name: &'static str,
    pub create_input: TypeScriptShape,
    pub actions: Vec<ActionContract>,
    pub events: Vec<EventContract>,
    pub types: Vec<TypeContract>,
    pub error: TypeScriptShape,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeScriptShape {
    pub input: String,
    pub output: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionContract {
    pub name: &'static str,
    pub public: bool,
    pub input: String,
    pub output: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventContract {
    pub name: &'static str,
    pub payload: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeContract {
    pub name: String,
    pub declaration: String,
}

pub fn export() -> ActorContract {
    let mut types = TypeCollector::default();
    types.collect::<crate::AgentOsActorCreateInput>();
    crate::action_set::collect_contract_types(&mut types);
    collect_event_types(&mut types);
    ActorContract {
        schema_version: 1,
        actor_name: crate::ACTOR_NAME,
        create_input: shape::<crate::AgentOsActorCreateInput>(),
        actions: crate::action_set::contract(),
        events: event_contract(),
        types: types.finish(),
        error: TypeScriptShape {
            input: "never".to_owned(),
            output: "{ group: string; code: string; message: string; metadata: JsonValue | null }"
                .to_owned(),
        },
    }
}

#[derive(Default)]
pub(crate) struct TypeCollector {
    seen: BTreeSet<TypeId>,
    declarations: BTreeMap<String, String>,
}

impl TypeCollector {
    pub(crate) fn collect<T: TS + 'static + ?Sized>(&mut self) {
        <Self as ts_rs::TypeVisitor>::visit::<T>(self);
    }

    fn finish(self) -> Vec<TypeContract> {
        self.declarations
            .into_iter()
            .map(|(name, declaration)| TypeContract { name, declaration })
            .collect()
    }
}

impl ts_rs::TypeVisitor for TypeCollector {
    fn visit<T: TS + 'static + ?Sized>(&mut self) {
        if !self.seen.insert(TypeId::of::<T>()) {
            return;
        }
        if T::output_path().is_some() {
            let name = T::ident();
            let declaration = T::decl();
            if let Some(previous) = self.declarations.insert(name.clone(), declaration.clone()) {
                assert_eq!(
                    previous, declaration,
                    "two Rust DTOs export the conflicting TypeScript name {name}"
                );
            }
        }
        T::visit_dependencies(self);
    }
}

pub(crate) fn input<T: TS>() -> String {
    normalize_input(T::inline())
}

pub(crate) fn output<T: TS>() -> String {
    normalize_output(T::inline())
}

fn shape<T: TS>() -> TypeScriptShape {
    let inline = T::inline();
    TypeScriptShape {
        input: normalize_input(inline.clone()),
        output: normalize_output(inline),
    }
}

fn normalize_input(value: String) -> String {
    value.replace("bigint", "number")
}

fn normalize_output(value: String) -> String {
    value.replace("bigint", "number | bigint")
}

fn event_contract() -> Vec<EventContract> {
    use rivetkit::Event;

    macro_rules! events {
        ($($event:ty),+ $(,)?) => {
            vec![$(
                EventContract {
                    name: <$event as Event>::NAME,
                    payload: output::<$event>(),
                }
            ),+]
        };
    }

    events!(
        crate::RuntimeBooted,
        crate::RuntimeShutdown,
        crate::RuntimeLimitWarning,
        crate::ProcessOutputEvent,
        crate::ProcessExitEvent,
        crate::TerminalDataEvent,
        crate::TerminalStderrEvent,
        crate::TerminalExitEvent,
        crate::CronFiredEvent,
    )
}

fn collect_event_types(types: &mut TypeCollector) {
    macro_rules! events {
        ($($event:ty),+ $(,)?) => {
            $(types.collect::<$event>();)+
        };
    }

    events!(
        crate::RuntimeBooted,
        crate::RuntimeShutdown,
        crate::RuntimeLimitWarning,
        crate::ProcessOutputEvent,
        crate::ProcessExitEvent,
        crate::TerminalDataEvent,
        crate::TerminalStderrEvent,
        crate::TerminalExitEvent,
        crate::CronFiredEvent,
    );
}

#[cfg(test)]
mod tests {
    use rivetkit::ActionSet;

    use super::*;

    #[test]
    fn contract_actions_match_registered_actions() {
        let registered = crate::action_set::AgentOsActionSet::entries()
            .into_iter()
            .map(|entry| entry.name)
            .collect::<Vec<_>>();
        let contract = export();
        let exported = contract
            .actions
            .iter()
            .map(|action| action.name)
            .collect::<Vec<_>>();
        assert_eq!(exported, registered);
        assert!(contract
            .actions
            .iter()
            .any(|action| !action.public && action.name == "__agentos.cron.invoke"));
    }

    #[test]
    fn contract_covers_prototype_wire_shapes() {
        let contract = export();
        assert_eq!(contract.actor_name, "agentOS");
        assert!(contract
            .types
            .iter()
            .any(|item| item.name == "FileBytes" && item.declaration.contains("Uint8Array")));
        assert!(contract.types.iter().any(|item| {
            item.name == "FileContentInput" && item.declaration.contains("string | Uint8Array")
        }));
        assert!(contract.types.iter().any(|item| item.name == "JsonValue"));
        assert!(contract
            .events
            .iter()
            .any(|event| event.name == "process.output"));
    }
}
