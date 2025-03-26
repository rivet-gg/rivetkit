import {
	ConfirmInput,
	Select,
	TextInput,
	ThemeProvider,
	defaultTheme,
	extendTheme,
} from "@inkjs/ui";
import { ExecaError } from "execa";
import { Box, Text, type TextProps } from "ink";
import Spinner from "ink-spinner";
import { type ReactNode, useState } from "react";
import stripAnsi from "strip-ansi";
import { type WorkflowAction, WorkflowError } from "../workflow";

const customTheme = extendTheme(defaultTheme, {
	components: {
		Select: {
			styles: {
				focusIndicator: () => ({
					color: "#ff4f00",
				}),
				label({ isFocused, isSelected }) {
					let color: string | undefined;

					if (isSelected) {
						color = "#ff4f00";
					}

					if (isFocused) {
						color = "#ff4f00";
					}

					return { color };
				},
			},
		},
	},
});

export const WorkflowDetails = ({
	tasks,
	interactive,
}: { tasks: WorkflowAction.Interface[]; interactive?: boolean }) => {
	return (
		<ThemeProvider theme={customTheme}>
			<Box flexDirection="column">
				<Tasks tasks={tasks} parent={null} interactive={interactive} />
			</Box>
		</ThemeProvider>
	);
};

function Tasks({
	tasks,
	parent,
	interactive,
	parentOpts,
}: {
	tasks: WorkflowAction.Interface[];
	parent: string | null;
	parentOpts?: WorkflowAction.Progress["meta"]["opts"];
	interactive?: boolean;
}) {
	const currentTasks = tasks.filter((task) => task.meta.parent === parent);

	if (currentTasks.length === 0) {
		return null;
	}
	return (
		<Box flexDirection="column">
			{currentTasks.map((task) => (
				<Box
					key={task.meta.id}
					flexDirection="column"
					marginLeft={parent && parentOpts?.showLabel !== false ? 2 : 0}
				>
					<Task task={task} parent={parent} interactive={interactive} />
					{"status" in task && task.status === "done" && interactive ? null : (
						<Tasks
							tasks={tasks}
							parent={task.meta.id}
							parentOpts={task.meta.opts}
							interactive={interactive}
						/>
					)}
				</Box>
			))}
		</Box>
	);
}

export function Task({
	task,
	parent,
	interactive,
}: {
	task: WorkflowAction.Interface;
	parent: string | null;
	interactive?: boolean;
}) {
	if ("__taskPrompt" in task) {
		if (task.opts.type === "select") {
			if (task.opts.answer) {
				return (
					<Box flexDirection="column">
						<Text>
							<Status value="done" interactive={interactive}>
								{task.question}{" "}
								{
									task.opts.choices.find((c) => c.value === task.opts.answer)
										?.label
								}
							</Status>
						</Text>
					</Box>
				);
			}
			return (
				<SelectQuestion task={task as WorkflowAction.Prompt.One<"select">} />
			);
		}
		if (task.opts.type === "confirm") {
			if (task.opts.answer !== null) {
				return (
					<Box flexDirection="column">
						<Text>
							<Status value="done" interactive={interactive}>
								{task.question} {task.opts.answer ? "Yes" : "No"}
							</Status>
						</Text>
					</Box>
				);
			}
			return (
				<Box flexDirection="row">
					<Text>
						<Text>❖ </Text>
						{task.question}{" "}
					</Text>
					<ConfirmInput
						onConfirm={() => {
							if (task.opts.type !== "confirm") return;
							task.opts.onSubmit(true);
						}}
						onCancel={() => {
							if (task.opts.type !== "confirm") return;
							task.opts.onSubmit(false);
						}}
					/>
				</Box>
			);
		}
		if (task.opts.type === "text") {
			if (task.opts.answer) {
				return (
					<Box flexDirection="column">
						<Text>
							<Status value="done" interactive={interactive}>
								{task.question} {task.opts.answer}
							</Status>
						</Text>
					</Box>
				);
			}
			return <TextQuestion task={task as WorkflowAction.Prompt.One<"text">} />;
		}
	}

	if ("__taskProgress" in task) {
		return (
			<>
				{task.meta.opts?.showLabel === false &&
				task.status !== "error" ? null : (
					<Status
						value={task.status}
						interactive={interactive}
						done={task.meta.opts?.success}
					>
						{task.meta.name}
					</Status>
				)}
				{task.status === "error" ? (
					<Box marginLeft={2}>
						{task.error instanceof WorkflowError ? (
							<Box flexDirection="column">
								<Text dimColor>{task.error.description}</Text>
								{task.error.opts.hint ? (
									<Text dimColor italic>
										<Text underline>Hint</Text> {task.error.opts.hint || ""}
									</Text>
								) : null}
							</Box>
						) : task.error instanceof ExecaError ? (
							<Box flexDirection="column">
								<Text dimColor>{task.error.shortMessage}</Text>
								{typeof task.error.stderr === "string" ? (
									<Text dimColor>{stripAnsi(task.error.stderr)}</Text>
								) : null}
							</Box>
						) : (
							<>
								<Text dimColor>{task.error?.toString()}</Text>
							</>
						)}
					</Box>
				) : null}
			</>
		);
	}
}

export function Status({
	value,
	children,
	interactive,
	done = <Text dimColor> (Done)</Text>,
	...rest
}: TextProps & {
	value: WorkflowAction.Progress["status"];
	interactive?: boolean;
	done?: ReactNode;
}) {
	return (
		<Text {...rest}>
			<Text color={"#ff4f00"}>
				{value === "done" ? "✔" : null}
				{value === "error" ? <Text color="red">✖</Text> : null}
				{value === "running" ? (
					interactive ? (
						<Spinner />
					) : (
						<Text>⠋</Text>
					)
				) : null}
			</Text>{" "}
			{children}
			{value === "running" && !interactive ? <Text>…</Text> : null}
			{value === "done" ? done : null}
		</Text>
	);
}

export function TextQuestion({
	task,
}: { task: WorkflowAction.Prompt.One<"text"> }) {
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = (value: string) => {
		if (task.opts.validate) {
			const validation = task.opts.validate(value);
			if (validation !== true) {
				setError(validation);
				return;
			}
		}
		task.opts.onSubmit(value);
	};

	return (
		<Box flexDirection="column">
			<Text>
				<Text>❖ </Text>
				{task.question}
			</Text>
			<TextInput
				placeholder={task.opts.placeholder}
				defaultValue={task.opts.defaultValue}
				onSubmit={handleSubmit}
			/>
			{error ? <Text color="red">✖ {error}</Text> : null}
		</Box>
	);
}

function SelectQuestion({
	task,
}: { task: WorkflowAction.Prompt.One<"select"> }) {
	return (
		<Box flexDirection="column">
			<Text>
				<Text>❖ </Text>
				{task.question}
			</Text>
			<Select
				options={task.opts.choices}
				onChange={task.opts.onSubmit}
				defaultValue={task.opts.defaultValue}
			/>
		</Box>
	);
}

export function Logs({ logs }: { logs: WorkflowAction.Log[] }) {
	return (
		<Box flexDirection="column">
			{logs.map((log, i) => {
				if (log.type === "log") {
					return (
						<Text key={i}>
							{"  "}
							{log.message}
						</Text>
					);
				}
				if (log.type === "error") {
					return (
						<Text key={i} color="red">
							<Text>❕ </Text>
							{log.message}
						</Text>
					);
				}
				if (log.type === "warn") {
					return (
						<Text key={i} color="yellow">
							<Text>⚠︎ </Text>
							{log.message}
						</Text>
					);
				}
			})}
		</Box>
	);
}
