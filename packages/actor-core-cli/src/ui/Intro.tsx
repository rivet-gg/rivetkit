import { Box, Text } from "ink";

export function Intro() {
	return (
		<Box flexDirection="column">
			<Box flexDirection="column" marginX={1} marginY={2}>
				<Text color={"#ff4f00"}>{"▄▀█ █▀▀ ▀█▀ █▀█ █▀█   █▀▀ █▀█ █▀█ █▀▀"}</Text>
				<Text color={"#ff4f00"}>{"█▀█ █▄▄  █  █▄█ █▀▄   █▄▄ █▄█ █▀▄ ██▄"}</Text>
			</Box>
		</Box>
	);
}
